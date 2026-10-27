import { EventEmitter } from 'node:events'
import type { Duplex } from 'node:stream'
import PromiseDuplex from 'promise-duplex'
import type { DeviceClient } from '@u4/adbkit'
import { default as adbkitPrebuilds } from '@u4/minicap-prebuilt'
import {
  encodeInjectKeycode,
  encodeInjectText,
  encodeTouchEvent,
  encodeScrollEvent,
  encodeBackOrScreenOn,
  encodeExpandNotificationPanel,
  encodeCollapsePanels,
  encodeRotateDevice,
  encodeSetClipboard,
  encodeSetDisplayPower,
} from './control-message.js'
import { DeviceMessageParser, type DeviceMessage } from './device-message.js'
import type { KeyActionValue, TouchActionValue } from './control-message.js'
import { AndroidKeycode, TouchAction } from './types.js'

/** 服务端版本:与 resources/scrcpy/scrcpy-server-v3.3.1.jar 及其 SHA-256 清单绑定。 */
export const SCRCPY_SERVER_VERSION = '3.3.1'

const REMOTE_JAR_DIR = '/data/local/tmp'
const PACKET_FLAG_CONFIG = 1n << 63n
const PACKET_FLAG_KEY_FRAME = 1n << 62n
const PTS_MASK = (1n << 62n) - 1n

export interface ScrcpySessionOptions {
  maxSize: number
  bitrate: number
  maxFps: number
  stayAwake: boolean
  /** 音频转发(AAC;需 Android 11+,连接顺序 video→audio→control)。 */
  audio?: boolean
  /** 视频编码 h264 | h265(默认 h264)。 */
  videoCodec?: 'h264' | 'h265'
}

export const DEFAULT_SESSION_OPTIONS: ScrcpySessionOptions = {
  maxSize: 0,
  bitrate: 8_000_000,
  maxFps: 0,
  stayAwake: false,
  audio: false,
  videoCodec: 'h264',
}

export interface ScrcpyMeta {
  deviceName: string
  codec: string
  width: number
  height: number
}

export interface VideoConfigInfo {
  /** SPS/PPS 原始 Annex-B 字节(首个 config 包)。 */
  raw: Uint8Array
  profileIndex: number
  constraintSet: number
  levelIndex: number
  croppedWidth: number
  croppedHeight: number
}

export interface MirrorStats {
  fps: number
  kbps: number
}

const CODEC_NAMES: Record<number, string> = {
  0x68323634: 'H264', // "h264"
  0x68323635: 'H265', // "h265"
  0x61763130: 'AV1', // "av10"
  0x6f707573: 'OPUS',
  0x6f727261: 'ORRA',
}

/** 生成 8 位十六进制 scid(scrcpy v2+ 要求 socket 名 scrcpy_<scid> 的一部分)。 */
export function generateScid(): string {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  // 服务端用 Integer.parseInt(scid, 16) 解析,符号位为 1 会抛 NumberFormatException,
  // 因此首字节限制在 0x00~0x7f,保证整值 ≤ 0x7fffffff。
  bytes[0] &= 0x7f
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * scrcpy v3.3.1 会话(自研实现)。
 *
 * 复用 @u4/adbkit 的底层原语(push / shell / openLocal2),但不使用其 Scrcpy 类:
 * - 该类把「shell 流结束」当作服务端退出,而定制 adbd 会在 socket 连接后随机断开 shell 流,
 *   导致会话随机夭折(实测);
 * - 其 touch/scroll 控制编码仍是 v1.x 格式,对 v3 服务端错误。
 *
 * 生命周期与字节布局依据 Genymobile/scrcpy v3.3.1 服务端源码并在真机校准:
 * 视频 socket:[dummy byte][64B 设备名][12B codecId+width+height][帧流…],
 * 帧头 12B = PTS u64(bit63=config 包 / bit62=关键帧)+ 长度 u32;控制 socket 双向消息。
 */
export class ScrcpySession extends EventEmitter {
  private static clipboardSeq = 0n
  private pendingAckSeq: bigint | null = null
  private scid = generateScid()
  private server: PromiseDuplex<Duplex> | null = null
  private videoSocket: PromiseDuplex<Duplex> | null = null
  private audioSocket: PromiseDuplex<Duplex> | null = null
  private controlSocket: PromiseDuplex<Duplex> | null = null
  private meta: ScrcpyMeta | null = null
  /** 最近一次 video-config 原始包(SPS/PPS;录制器初始化用)。 */
  lastVideoConfig: Uint8Array | null = null
  private frameParser: ((chunk: Buffer) => void) | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private frameCount = 0
  private byteCount = 0
  private lastFrameCount = 0
  private lastByteCount = 0
  private stopped = false

  constructor(
    private readonly device: DeviceClient,
    private readonly options: Partial<ScrcpySessionOptions> = {},
    private readonly jarPath?: string,
  ) {
    super()
  }

  async start(): Promise<ScrcpyMeta> {
    const opts = { ...DEFAULT_SESSION_OPTIONS, ...this.options }
    const jarPath = this.jarPath ?? adbkitPrebuilds.getScrcpyJar(SCRCPY_SERVER_VERSION)
    const remoteJar = `${REMOTE_JAR_DIR}/scrcpy-server-v${SCRCPY_SERVER_VERSION}.jar`
    await this.pushJar(jarPath, remoteJar)
    await this.launchServer(remoteJar, opts)

    // 服务端 LocalServerSocket 在 DesktopConnection.open 即监听,轮询连接直至成功。
    // 连接顺序与 adbkit/官方客户端一致:先齐 video+control 两个连接,再读前导 ——
    // 服务端 tunnel_forward 模式下逐个 accept,StepX 链路在两个连接齐备前不回发数据。
    const socketName = `localabstract:scrcpy_${this.scid}`
    this.videoSocket = await this.connectWithRetry(socketName, 'video')
    // 立即转 paused 模式,前导用同步原语读取(promise-duplex 默认 flowing 会吞数据)
    this.videoSocket.stream.pause()
    if (opts.audio === true) {
      this.audioSocket = await this.connectWithRetry(socketName, 'audio')
      // 关键:立即同步注册 data 泵(flowing 模式),避免 pause/resume 竞态
      this.wireAudioPump(this.audioSocket)
    }
    this.controlSocket = await this.connectWithRetry(socketName, 'control')
    const meta = await this.readVideoPreamble()
    this.meta = meta
    this.startDeviceMessagePump()
    this.startFrameLoop()
    this.startStats()
    return meta
  }

  /** 音频流:4B codecId → 帧包(12B PTS 头 + AAC)。持续 data 泵 + 状态机(flowing,连接后立即注册)。 */
  private wireAudioPump(sock: NonNullable<ScrcpySession['audioSocket']>): void {
    let pending: Buffer = Buffer.alloc(0)
    let codecSent = false
    let header: { pts: bigint; len: number } | null = null
    const parse = (chunk: Buffer): void => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      for (;;) {
        if (!codecSent) {
          if (pending.length < 4) return
          this.emit('audio-meta', { codecId: pending.readUInt32BE(0) })
          pending = pending.subarray(4)
          codecSent = true
          continue
        }
        if (!header) {
          if (pending.length < 12) return
          const pts = pending.readBigUInt64BE(0)
          const len = pending.readUInt32BE(8)
          pending = pending.subarray(12)
          header = { pts, len }
        }
        if (pending.length < header.len) return
        const body = pending.subarray(0, header.len)
        pending = pending.subarray(header.len)
        const { pts } = header
        header = null
        if ((pts & PACKET_FLAG_CONFIG) !== 0n) {
          this.emit('audio-config', { raw: body })
        } else {
          this.emit('audio-frame', { data: body, ptsUs: Number(pts & PTS_MASK) })
        }
      }
    }
    sock.stream.on('data', parse)
    sock.stream.on('close', () => undefined)
  }

  private startDeviceMessagePump(): void {
    const sock = this.controlSocket
    if (!sock) return
    const parser = new DeviceMessageParser((msg) => {
      if (msg.type === 'ackSetClipboard') {
        this.pendingAckSeq = msg.sequence
      }
      this.emit('device-message', msg)
    })
    sock.stream.on('data', (chunk: Buffer) => parser.push(chunk))
  }

  /**
   * 拉取手机剪贴板文本(发送 GET_CLIPBOARD,等待 CLIPBOARD 响应)。
   * 注意:与 frame 事件不同,CLIPBOARD 响应走 device-message 事件,此处临时监听。
   */
  getClipboard(timeoutMs = 3000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('device-message', onMsg)
        reject(new Error('拉取手机剪贴板超时'))
      }, timeoutMs)
      const onMsg = (msg: DeviceMessage): void => {
        if (msg.type === 'clipboard') {
          clearTimeout(timer)
          this.removeListener('device-message', onMsg)
          resolve(msg.text)
        }
      }
      this.on('device-message', onMsg)
      // v3:GET_CLIPBOARD=8,copyKey=0
      this.send(Buffer.from([8, 0]))
    })
  }

  /** 推送文本到手机剪贴板,等待 ACK;paste=true 时顺带触发手机端粘贴。 */
  setClipboard(text: string, paste = false, timeoutMs = 3000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sequence = ++ScrcpySession.clipboardSeq
      const timer = setTimeout(() => {
        this.removeListener('device-message', onMsg)
        reject(new Error('设置手机剪贴板超时(未收到 ACK)'))
      }, timeoutMs)
      const onMsg = (msg: DeviceMessage): void => {
        if (msg.type === 'ackSetClipboard' && msg.sequence === sequence) {
          clearTimeout(timer)
          this.removeListener('device-message', onMsg)
          resolve()
        }
      }
      this.on('device-message', onMsg)
      this.send(encodeSetClipboard(text, sequence, paste))
    })
  }

  get stats(): { frames: number; bytes: number } {
    return { frames: this.frameCount, bytes: this.byteCount }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
    // 关闭 socket 即触发服务端自动退出(cleanup)
    try {
      this.controlSocket?.destroy()
    } catch {
      /* 已关闭 */
    }
    try {
      this.audioSocket?.destroy()
    } catch {
      /* 已关闭 */
    }
    try {
      this.videoSocket?.destroy()
    } catch {
      /* 已关闭 */
    }
    try {
      this.server?.destroy()
    } catch {
      /* 已关闭 */
    }
    this.emit('disconnect')
  }

  // ── 启动细节 ──────────────────────────────────────────────

  private async pushJar(localJar: string, remoteJar: string): Promise<void> {
    const { statSync } = await import('node:fs')
    let localSize = 0
    try {
      localSize = statSync(localJar).size
    } catch {
      throw new Error(`scrcpy-server 不存在:${localJar}`)
    }
    const remote = await this.device.stat(remoteJar).catch(() => null)
    if (remote && remote.size === localSize) return // 已推送,跳过
    const { createReadStream } = await import('node:fs')
    const transfer = await this.device.push(createReadStream(localJar), remoteJar, 0o644)
    await transfer.waitForEnd()
  }

  private async launchServer(remoteJar: string, opts: ScrcpySessionOptions): Promise<void> {
    const args = [
      `scid=${this.scid}`,
      `audio=${opts.audio === true}`,
      opts.audio === true ? 'audio_codec=aac' : 'audio=false',
      'audio_source=playback',
      `video_codec=${opts.videoCodec ?? 'h264'}`,
      'video_source=display',
      'log_level=info',
      `max_size=${opts.maxSize}`,
      'clipboard_autosync=false',
      `video_bit_rate=${opts.bitrate}`,
      `max_fps=${opts.maxFps}`,
      'lock_video_orientation=-1',
      'tunnel_forward=true',
      'send_frame_meta=true',
      'control=true',
      'display_id=0',
      'show_touches=false',
      `stay_awake=${opts.stayAwake}`,
      'power_off_on_close=false',
      'downsize_on_error=true',
      'send_device_meta=true',
      'send_dummy_byte=true',
      'cleanup=true',
    ]
    const cmd = `CLASSPATH=${remoteJar} app_process / com.genymobile.scrcpy.Server ${SCRCPY_SERVER_VERSION} ${args.join(' ')}`
    const duplex = await this.device.shell(cmd)
    const serverDuplex = new PromiseDuplex(duplex)
    this.server = serverDuplex

    // 服务端输出全程保留:既作就绪信号,也作死亡取证(临时诊断用 emit('server-log'))
    const serverStream = serverDuplex.stream
    const serverReady = new Promise<void>((resolve) => {
      let buf = ''
      const timer = setTimeout(() => resolve(), 6000)
      const onData = (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        buf += text
        if (text.includes('[server] ERROR')) {
          this.emit('error', new Error(text.trim()))
        }
        if (buf.includes('[server] INFO: Device: ')) {
          clearTimeout(timer)
          resolve()
        }
      }
      serverStream.on('data', onData)
    })
    serverStream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim()
      if (text) this.emit('server-log', text)
    })
    serverStream.on('close', () => {
      if (!this.stopped && this.videoSocket === null) {
        this.emit('error', new Error('scrcpy 服务端启动后立即退出'))
      }
    })
    await serverReady
    await new Promise((r) => setTimeout(r, 100))
  }

  private async connectWithRetry(abstractName: string, role: string): Promise<PromiseDuplex<Duplex>> {
    const deadline = Date.now() + 8000
    for (;;) {
      if (this.stopped) throw new Error('会话已停止')
      try {
        return await this.device.openLocal2(abstractName, `amoolink ${role}`)
      } catch {
        if (Date.now() > deadline) {
          throw new Error(`连接 ${abstractName}(${role})超时:服务端未就绪`)
        }
        await new Promise((r) => setTimeout(r, 120))
      }
    }
  }

  /** 读取视频 socket 前导:1B dummy + 64B 设备名 + 12B codecId/宽高。 */
  private async readVideoPreamble(): Promise<ScrcpyMeta> {
    const sock = this.videoSocket
    if (!sock) throw new Error('视频通道未建立')
    const stream = sock.stream
    await this.waitReadable(sock)
    const dummy = stream.read(1) as Buffer | null
    if (!dummy || dummy.length === 0 || dummy[0] !== 0) {
      throw new Error(`视频通道首字节异常:0x${dummy?.[0]?.toString(16) ?? 'none'}`)
    }
    await this.waitReadable(sock)
    const nameBuf = stream.read(64) as Buffer | null
    if (!nameBuf || nameBuf.length < 64) throw new Error('读取设备名失败')
    await this.waitReadable(sock)
    const head = stream.read(12) as Buffer | null
    if (!head || head.length < 12) throw new Error('读取视频头失败')
    const codecId = head.readUInt32BE(0)
    return {
      deviceName: nameBuf.toString('utf8').replace(/\0.*$/, '').trim(),
      codec: CODEC_NAMES[codecId] ?? `0x${codecId.toString(16)}`,
      width: head.readUInt32BE(4),
      height: head.readUInt32BE(8),
    }
  }

  private async waitReadable(sock: PromiseDuplex<Duplex>, timeoutMs = 8000): Promise<void> {
    const stream = sock.stream
    if (stream.readableLength > 0) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`等待服务端数据超时(${timeoutMs}ms)`))
      }, timeoutMs)
      const onReadable = (): void => {
        cleanup()
        resolve()
      }
      const onClose = (): void => {
        cleanup()
        reject(new Error('服务端连接已断开'))
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        stream.removeListener('readable', onReadable)
        stream.removeListener('close', onClose)
      }
      stream.once('readable', onReadable)
      stream.once('close', onClose)
    })
  }

  private startFrameLoop(): void {
    const sock = this.videoSocket
    if (!sock) return
    sock.stream.pause()
    let pending: Buffer = Buffer.alloc(0)
    let header: { pts: bigint; len: number } | null = null
    const parse = (chunk: Buffer): void => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      for (;;) {
        if (!header) {
          if (pending.length < 12) return
          const pts = pending.readBigUInt64BE(0)
          const len = pending.readUInt32BE(8)
          pending = pending.subarray(12)
          header = { pts, len }
        }
        if (pending.length < header.len) return
        const body = pending.subarray(0, header.len)
        pending = pending.subarray(header.len)
        const { pts, len } = header
        header = null
        if ((pts & PACKET_FLAG_CONFIG) !== 0n) {
          const config = parseH264Config(body)
          this.lastVideoConfig = body
          this.emit('video-config', config)
        } else {
          const keyframe = (pts & PACKET_FLAG_KEY_FRAME) !== 0n
          this.frameCount += 1
          this.byteCount += len
          this.emit('frame', {
            data: body,
            ptsUs: Number(pts & PTS_MASK),
            keyframe,
          })
        }
      }
    }
    this.frameParser = parse
    // resumed 流动模式:此前前导读取阶段处于 paused
    sock.stream.on('data', (chunk: Buffer) => parse(chunk))
    sock.stream.resume()
    sock.stream.on('close', () => {
      if (!this.stopped) {
        this.emit('disconnect')
        this.stopStats()
      }
    })
  }

  private startStats(): void {
    this.statsTimer = setInterval(() => {
      const fps = this.frameCount - this.lastFrameCount
      const bytes = this.byteCount - this.lastByteCount
      this.lastFrameCount = this.frameCount
      this.lastByteCount = this.byteCount
      this.emit('stats', { fps, kbps: Math.round(bytes / 1024) } satisfies MirrorStats)
    }, 1000)
  }

  private stopStats(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
  }

  // ── 控制注入(自有编码器,直写控制 socket;坐标为视频内像素)────────

  private send(buf: Buffer): void {
    const sock = this.controlSocket
    if (!sock) {
      this.emit('error', new Error('控制通道未建立'))
      return
    }
    void sock.write(buf).catch((err: unknown) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    })
  }

  private screen(): { w: number; h: number } {
    return { w: this.meta?.width ?? 0, h: this.meta?.height ?? 0 }
  }

  /** 触摸注入;xPx/yPx 为视频坐标像素(服务端按屏幕尺寸映射)。 */
  injectTouch(
    action: TouchActionValue,
    pointerId: number | bigint,
    xPx: number,
    yPx: number,
    pressure = 1,
  ): void {
    const { w, h } = this.screen()
    this.send(
      encodeTouchEvent({
        action,
        pointerId,
        xPx,
        yPx,
        screenW: w,
        screenH: h,
        pressure: action === TouchAction.UP ? 0 : pressure,
      }),
    )
  }

  injectKey(action: KeyActionValue, keycode: number, repeat = 0, metaState = 0): void {
    this.send(encodeInjectKeycode(action, keycode, repeat, metaState))
  }

  injectText(text: string): void {
    this.send(encodeInjectText(text))
  }

  /** 滚轮注入;vUnits/hUnits 为滚动单位(1=一格,鼠标下滚为负)。 */
  scroll(xPx: number, yPx: number, vUnits: number, hUnits = 0): void {
    const { w, h } = this.screen()
    this.send(encodeScrollEvent({ xPx, yPx, screenW: w, screenH: h, hUnits, vUnits }))
  }

  /** 点击(xPx, yPx 为视频坐标像素)。 */
  tap(xPx: number, yPx: number): void {
    const genericPointer = BigInt.asUintN(64, -1n)
    this.injectTouch(TouchAction.DOWN, genericPointer, xPx, yPx)
    this.injectTouch(TouchAction.UP, genericPointer, xPx, yPx)
  }

  goHome(): void {
    this.injectKey(1, AndroidKeycode.HOME)
    this.injectKey(0, AndroidKeycode.HOME)
  }

  goBack(): void {
    this.send(encodeBackOrScreenOn(0))
  }

  appSwitch(): void {
    this.injectKey(1, AndroidKeycode.APP_SWITCH)
    this.injectKey(0, AndroidKeycode.APP_SWITCH)
  }

  volumeUp(): void {
    this.injectKey(1, AndroidKeycode.VOLUME_UP)
    this.injectKey(0, AndroidKeycode.VOLUME_UP)
  }

  volumeDown(): void {
    this.injectKey(1, AndroidKeycode.VOLUME_DOWN)
    this.injectKey(0, AndroidKeycode.VOLUME_DOWN)
  }

  /**
   * 唤醒亮屏(实测:Dozing 状态下 BACK_OR_SCREEN_ON 的 WAKEUP 无效,
   * 直接注入 KEYCODE_WAKEUP=224 才能唤醒,StepX/Android 16 真机验证)。
   */
  screenOn(): void {
    this.injectKey(1, 224) // KEYCODE_WAKEUP down
    this.injectKey(0, 224) // up
    // 保险:同时发协议级亮屏(部分设备/状态下有效)
    this.send(encodeBackOrScreenOn(1))
  }

  /**
   * 请求服务端重启视频通道(RESET_VIDEO, v3 type=17):
   * 立即下发新 config(SPS/PPS)+ 关键帧 —— 录制从任意时刻开始也能拿到 I 帧。
   */
  resetVideo(): void {
    this.send(Buffer.from([17]))
  }

  /**
   * 物理屏电源控制(黑屏模式):off 时手机屏熄灭但系统保持 Awake,
   * 虚拟显示继续编码 —— 电脑端画面与反控不受影响。
   */
  setDisplayPower(on: boolean): void {
    this.send(encodeSetDisplayPower(on))
  }

  expandNotifications(): void {
    this.send(encodeExpandNotificationPanel())
  }

  collapsePanels(): void {
    this.send(encodeCollapsePanels())
  }

  rotateDevice(): void {
    this.send(encodeRotateDevice())
  }
}

/** 解析 SPS(avcC 概要字节),供 WebCodecs codec 字符串使用。 */
function parseH264Config(body: Buffer): VideoConfigInfo {
  let profile = 100
  let constraint = 0
  let level = 40
  // 跳过起始码,寻找 SPS NAL(type 7)
  for (let i = 0; i + 4 < body.length; i++) {
    if (body[i] === 0 && body[i + 1] === 0 && body[i + 2] === 1 && (body[i + 3] & 0x1f) === 7) {
      profile = body[i + 4]
      constraint = body[i + 5]
      level = body[i + 6]
      break
    }
    if (body[i] === 0 && body[i + 1] === 0 && body[i + 2] === 0 && body[i + 3] === 1 && (body[i + 4] & 0x1f) === 7) {
      profile = body[i + 5]
      constraint = body[i + 6]
      level = body[i + 7]
      break
    }
  }
  return {
    raw: body,
    profileIndex: profile,
    constraintSet: constraint,
    levelIndex: level,
    croppedWidth: 0,
    croppedHeight: 0,
  }
}
