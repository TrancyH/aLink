import { BrowserWindow, clipboard, ClipboardItem, app, screen } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { execOut } from '@amoolink/adb'
import { deviceService } from './device-service'
import { settingsStore } from '../settings-store'
import {
  ScrcpySession,
  SCRCPY_SERVER_VERSION,
  type MirrorStats,
  type ScrcpyMeta,
  type VideoConfigInfo,
} from '@amoolink/scrcpy-client'

/** 单设备投屏会话:MirrorService 内部管理单元。 */
interface MirrorEntry {
  serial: string
  session: ScrcpySession
  win: BrowserWindow
  state: 'starting' | 'streaming' | 'retrying' | 'error' | 'stopped'
  meta?: ScrcpyMeta
  configSent: boolean
  retries: number
  /** 黑屏模式:手机物理屏熄灭但投屏/反控继续。 */
  blackScreen: boolean
  /** 智能黑屏:由电脑操控触发(物理触屏自动恢复)。 */
  autoBlacked: boolean
  /** 首次拿到视频 meta 后是否已按比例调整过窗口尺寸(之后尊重用户手动调整)。 */
  sizeFitted: boolean
  /** 物理触摸监听(getevent 流,智能黑屏期间持有)。 */
  touchWatch?: NodeJS.ReadableStream & { destroy(): void } | null
}

const MAX_RETRIES = 3

/** 内置 scrcpy-server.jar 路径(开发与打包两种形态)。 */
function bundledServerJar(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'scrcpy', `scrcpy-server-v${SCRCPY_SERVER_VERSION}.jar`)
    : join(app.getAppPath(), 'resources', 'scrcpy', `scrcpy-server-v${SCRCPY_SERVER_VERSION}.jar`)
}

class MirrorService extends EventEmitter {
  private entries = new Map<string, MirrorEntry>()

  listSessions(): Array<{ serial: string; state: MirrorEntry['state']; meta?: ScrcpyMeta }> {
    return [...this.entries.values()].map((e) => ({ serial: e.serial, state: e.state, meta: e.meta }))
  }

  isMirroring(serial: string): boolean {
    return this.entries.has(serial)
  }

  // ── 息屏看护(修复:息屏后画面黑/反控失效)───────────────
  // 投屏会话期间轮询电源状态:系统 Asleep → 唤醒(黑屏模式下再熄物理屏),
  // 保证虚拟显示持续编码、注入通道有效。限频 ≥5s 防抖。
  private wakeGuards = new Map<string, ReturnType<typeof setInterval>>()
  private lastWakeAt = new Map<string, number>()

  startWakeGuard(serial: string): void {
    if (this.wakeGuards.has(serial)) return
    const guard = setInterval(() => {
      void this.wakeTick(serial)
    }, 2000)
    this.wakeGuards.set(serial, guard)
  }

  private stopWakeGuard(serial: string): void {
    const guard = this.wakeGuards.get(serial)
    if (guard) {
      clearInterval(guard)
      this.wakeGuards.delete(serial)
    }
  }

  private async wakeTick(serial: string): Promise<void> {
    const entry = this.entries.get(serial)
    if (!entry || entry.state === 'stopped' || entry.state === 'error') {
      this.stopWakeGuard(serial)
      return
    }
    // 限频:5s 内不重复唤醒
    const last = this.lastWakeAt.get(serial) ?? 0
    if (Date.now() - last < 5000) return
    try {
      const client = await deviceService.getDeviceClient(serial)
      if (!client) return
      const power = await execOut(client, 'dumpsys power')
      if (!/mWakefulness=Asleep/.test(power)) return
      this.lastWakeAt.set(serial, Date.now())
      // 系统休眠 → 唤醒(恢复编码与注入)
      entry.session.screenOn()
      if (entry.blackScreen) {
        // 黑屏模式:唤醒系统后立刻熄灭物理屏(虚拟显示不受影响)
        setTimeout(() => entry.session.setDisplayPower(false), 400)
      }
    } catch {
      // 单次查询失败跳过
    }
  }

  // ── 智能黑屏:电脑操控 → 熄手机屏;物理触屏 → 恢复 ──
  /** 电脑端首次操控触发(仅 streaming 会话;设置开启且当前未黑屏)。 */
  private maybeAutoBlackout(entry: MirrorEntry): void {
    if (!settingsStore.get().mirror.autoBlackScreen) return
    if (entry.blackScreen || entry.autoBlacked) return
    if (entry.state !== 'streaming' && entry.state !== 'starting') return
    entry.autoBlacked = true
    this.applyBlackout(entry, true)
    this.toast(entry.serial, '已智能熄灭手机屏幕(触控手机屏幕即可点亮)')
    void this.watchPhysicalTouch(entry)
  }

  /**
   * 黑屏/恢复。StepX 实测 SET_DISPLAY_POWER 静默无效,
   * 故用亮度降到 1(近黑,系统保持 Awake)为主 + DISPLAY_POWER 双保险。
   */
  private applyBlackout(entry: MirrorEntry, off: boolean): void {
    entry.blackScreen = off
    entry.session.setDisplayPower(!off)
    if (off) {
      void this.dimScreen(entry.serial)
      this.startWakeGuard(entry.serial)
    } else {
      void this.restoreBrightness(entry.serial)
    }
  }

  private brightnessSaved = new Map<string, string>()

  private async withClient(serial: string): Promise<Awaited<ReturnType<typeof deviceService.getDeviceClient>>> {
    return await deviceService.getDeviceClient(serial)
  }

  private async dimScreen(serial: string): Promise<void> {
    try {
      const client = await this.withClient(serial)
      if (!client) return
      const cur = (await execOut(client, 'settings get system screen_brightness')).trim()
      if (cur && cur !== 'null' && cur !== '1') this.brightnessSaved.set(serial, cur)
      await execOut(client, 'settings put system screen_brightness 1')
    } catch {
      /* 亮度失败不影响投屏 */
    }
  }

  private async restoreBrightness(serial: string): Promise<void> {
    const saved = this.brightnessSaved.get(serial)
    if (!saved) return
    this.brightnessSaved.delete(serial)
    try {
      const client = await this.withClient(serial)
      if (!client) return
      await execOut(client, `settings put system screen_brightness ${saved}`)
    } catch {
      /* 设备可能已断开 */
    }
  }

  /** 监听触摸屏物理事件(getevent);收到 → 点亮恢复并停止监听。 */
  private async watchPhysicalTouch(entry: MirrorEntry): Promise<void> {
    try {
      const client = await deviceService.getDeviceClient(entry.serial)
      if (!client) return
      const pl = await execOut(client, 'getevent -pl')
      // 选 ABS_MT_POSITION_X 且量程最大的设备(主触摸屏)
      const devs = pl.split('add device')
      let best: string | null = null
      let bestMax = 0
      for (const d of devs) {
        const name = /\/dev\/input\/event\d+/.exec(d)?.[0]
        const mx = /ABS_MT_POSITION_X\s*:\s*value \d+, min \d+, max (\d+)/.exec(d)
        if (name && mx && Number(mx[1]) > bestMax) {
          bestMax = Number(mx[1])
          best = name
        }
      }
      if (!best) return
      const stream = await client.shell(`getevent -c 1 '${best}'`)
      const duplex = stream as unknown as NodeJS.ReadableStream & { destroy(): void }
      entry.touchWatch = duplex
      duplex.once?.('data', () => {
        this.stopTouchWatch(entry)
        if (entry.autoBlacked) {
          entry.autoBlacked = false
          this.applyBlackout(entry, false)
          this.toast(entry.serial, '手机屏幕已点亮')
        }
      })
      duplex.once?.('close', () => {
        // getevent 结束(超时/异常)而未收到事件:保持黑屏由看护兜底
      })
    } catch {
      // 监听失败:保持现状(手动 🌙 仍可用)
    }
  }

  private stopTouchWatch(entry: MirrorEntry): void {
    if (entry.touchWatch) {
      try {
        entry.touchWatch.destroy()
      } catch {
        /* 已关闭 */
      }
      entry.touchWatch = null
    }
  }

  /** 黑屏模式开关:开 = 熄灭手机物理屏(投屏与反控继续);关 = 点亮。 */
  setBlackScreen(serial: string, on: boolean): void {
    const entry = this.entries.get(serial)
    if (!entry) return
    entry.autoBlacked = false
    this.stopTouchWatch(entry)
    this.applyBlackout(entry, on)
  }

  isBlackScreen(serial: string): boolean {
    return this.entries.get(serial)?.blackScreen ?? false
  }

  async startMirror(serial: string): Promise<void> {
    if (this.entries.has(serial)) {
      const win = this.entries.get(serial)?.win
      if (win && !win.isDestroyed()) {
        win.focus()
        return
      }
      this.stopMirror(serial)
    }

    const client = await deviceService.getDeviceClient(serial)
    if (!client) throw new Error(`设备 ${serial} 不可用`)

    // 先开窗口再启动会话:窗口即视频消费者,避免帧事件无人接收
    const win = this.createMirrorWindow(serial)
    const session = new ScrcpySession(client, settingsStore.get().mirror, bundledServerJar())
    const entry: MirrorEntry = {
      serial,
      session,
      win,
      state: 'starting',
      configSent: false,
      retries: 0,
      blackScreen: false,
      autoBlacked: false,
      sizeFitted: false,
    }
    this.entries.set(serial, entry)
    this.wireSessionEvents(entry)
    await this.launch(entry)
    if (entry.state === 'starting' || entry.state === 'streaming') {
      this.startWakeGuard(serial)
      this.emit('session-started', serial)
    }
  }

  stopMirror(serial: string): void {
    const entry = this.entries.get(serial)
    if (!entry) return
    entry.state = 'stopped'
    this.stopWakeGuard(serial)
    entry.autoBlacked = false
    this.stopTouchWatch(entry)
    if (entry.blackScreen) {
      try {
        entry.session.setDisplayPower(true)
      } catch {
        /* 会话已死 */
      }
      void this.restoreBrightness(serial)
    }
    this.entries.delete(serial)
    this.emit('session-stopped', serial)
    try {
      entry.session.stop()
    } catch {
      // 忽略停止异常
    }
    if (!entry.win.isDestroyed()) entry.win.close()
  }

  /** 投屏窗口置顶开关。 */
  setPinned(serial: string, pinned: boolean): void {
    const entry = this.entries.get(serial)
    if (entry && !entry.win.isDestroyed()) {
      entry.win.setAlwaysOnTop(pinned, 'screen-saver')
    }
  }

  /** 取设备的活动会话(剪贴板同步等控制通道功能使用;无会话返回 null)。 */
  getSession(serial: string): ScrcpySession | null {
    const entry = this.entries.get(serial)
    if (!entry || entry.state === 'stopped' || entry.state === 'error') return null
    return entry.session
  }

  stopAll(): void {
    for (const serial of [...this.entries.keys()]) this.stopMirror(serial)
  }

  // ── 内部实现 ──────────────────────────────────────────────

  /** 工具条内容高度(7+11 padding + 30 按钮 + 1 边框),与 MirrorWindow.css 保持一致。 */
  private static readonly TOOLBAR_PX = 49

  /** 依据视频 meta 锁定窗口画面比例并做首次尺寸自适应,消除黑边。 */
  private fitMirrorWindow(entry: MirrorEntry): void {
    const meta = entry.meta
    if (!meta || meta.width <= 0 || meta.height <= 0) return
    const win = entry.win
    if (win.isDestroyed()) return
    const toolbar = MirrorService.TOOLBAR_PX
    // 窗口缩放时保持画面区 = 视频宽高比;工具条高度不参与比例
    win.setAspectRatio(meta.width / meta.height, { width: 0, height: toolbar })
    if (entry.sizeFitted) return // 仅首次;重试重建会话时尊重用户手动调整的尺寸
    entry.sizeFitted = true
    const area = screen.getDisplayMatching(win.getBounds()).workArea
    const scale = Math.min(
      1,
      (area.width - 48) / meta.width,
      (area.height - 48 - toolbar) / meta.height,
    )
    if (scale > 0 && Number.isFinite(scale)) {
      win.setContentSize(Math.round(meta.width * scale), Math.round(meta.height * scale) + toolbar)
    }
  }

  private createMirrorWindow(serial: string): BrowserWindow {
    const win = new BrowserWindow({
      width: 460,
      height: 920,
      minWidth: 320,
      minHeight: 560,
      useContentSize: true,
      show: false,
      autoHideMenuBar: true,
      // 系统标准标题栏(白底交通灯),与画面/工具条分离
      titleBarStyle: 'default',
      titleBarOverlay: process.platform === 'win32' ? { color: '#f5f5f7', symbolColor: '#333' } : undefined,
      backgroundColor: '#000000',
      title: 'AmooLink 投屏',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
      },
    })
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => this.stopMirror(serial))

    const route = `#/mirror-window/${serial}`
    if (process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${route}`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route.slice(1) })
    }
    return win
  }

  /** 会话事件接线(每次重建会话后重挂)。 */
  private wireSessionEvents(entry: MirrorEntry): void {
    const session = entry.session
    const send = (channel: string, payload: unknown): void => {
      if (!entry.win.isDestroyed()) entry.win.webContents.send(channel, { serial: entry.serial, payload })
    }

    session.on('video-config', (config: VideoConfigInfo) => {
      send('amoolink:mirror:config', {
        raw: config.raw,
        profileIndex: config.profileIndex,
        constraintSet: config.constraintSet,
        levelIndex: config.levelIndex,
        width: config.croppedWidth || entry.meta?.width || 0,
        height: config.croppedHeight || entry.meta?.height || 0,
      })
    })
    session.on('frame', (frame: { data: Uint8Array; ptsUs: number; keyframe: boolean }) => {
      if (entry.state === 'starting') {
        entry.state = 'streaming'
        send('amoolink:mirror:state', { state: 'streaming', meta: entry.meta })
      }
      send('amoolink:mirror:frame', {
        data: frame.data,
        ptsUs: frame.ptsUs,
        keyframe: frame.keyframe,
      })
    })
    session.on('stats', (stats: MirrorStats) => {
      send('amoolink:mirror:stats', stats)
    })
    session.on('audio-meta', (m: { codecId: number }) => {
      send('amoolink:mirror:audio-meta', m)
    })
    session.on('audio-config', (c: { raw: Uint8Array }) => {
      send('amoolink:mirror:audio-config', { raw: c.raw })
    })
    session.on('audio-frame', (f: { data: Uint8Array; ptsUs: number }) => {
      send('amoolink:mirror:audio-frame', { data: f.data, ptsUs: f.ptsUs })
    })
    session.on('error', (err: Error) => {
      if (entry.state === 'stopped') return
      send('amoolink:mirror:state', { state: 'error', message: err.message })
    })
    session.on('disconnect', () => {
      if (entry.state === 'stopped' || entry.state === 'retrying') return
      this.handleDisconnect(entry)
    })
  }

  private async launch(entry: MirrorEntry): Promise<void> {
    try {
      const meta = await entry.session.start()
      entry.meta = meta
      entry.configSent = false
      if (!entry.win.isDestroyed()) {
        entry.win.setTitle(`${meta.deviceName.trim()} — AmooLink 投屏`)
        this.fitMirrorWindow(entry)
      }
      entry.state = 'starting' // 等待首帧后转 streaming
    } catch (err) {
      if (entry.state === 'stopped') return
      const message = err instanceof Error ? err.message : String(err)
      entry.retries += 1
      if (entry.retries <= MAX_RETRIES) {
        entry.state = 'retrying'
        this.notifyState(entry, { state: 'retrying', attempt: entry.retries, message })
        await delay(800 * entry.retries)
        if (entry.state !== 'retrying') return
        // 会话对象不可复用,重建后重试
        try {
          entry.session.stop()
        } catch {
          // 旧会话可能已死
        }
        const client = await deviceService.getDeviceClient(entry.serial)
        if (!client) {
          entry.state = 'error'
          this.notifyState(entry, { state: 'error', message: '设备已断开' })
          return
        }
        entry.session = new ScrcpySession(client, settingsStore.get().mirror, bundledServerJar())
        this.wireSessionEvents(entry)
        await this.launch(entry)
      } else {
        entry.state = 'error'
        this.notifyState(entry, { state: 'error', message })
      }
    }
  }

  private handleDisconnect(entry: MirrorEntry): void {
    if (entry.state === 'streaming' || entry.state === 'starting') {
      entry.retries += 1
      if (entry.retries <= MAX_RETRIES) {
        entry.state = 'retrying'
        this.notifyState(entry, { state: 'retrying', attempt: entry.retries, message: '连接中断,自动重连中' })
        void this.relaunch(entry)
      } else {
        entry.state = 'error'
        this.notifyState(entry, { state: 'error', message: '连接反复中断' })
      }
    }
  }

  private async relaunch(entry: MirrorEntry): Promise<void> {
    await delay(600)
    if (entry.state !== 'retrying') return
    try {
      entry.session.stop()
    } catch {
      // 旧会话可能已死
    }
    const client = await deviceService.getDeviceClient(entry.serial)
    if (!client) {
      entry.state = 'error'
      this.notifyState(entry, { state: 'error', message: '设备已断开' })
      return
    }
    // 重建会话(ScrcpySession 不可复用)
    const fresh: MirrorEntry = {
      serial: entry.serial,
      session: new ScrcpySession(client, settingsStore.get().mirror, bundledServerJar()),
      win: entry.win,
      state: 'starting',
      meta: entry.meta,
      configSent: false,
      retries: entry.retries,
      blackScreen: entry.blackScreen,
      autoBlacked: false,
      sizeFitted: entry.sizeFitted,
    }
    this.entries.set(entry.serial, fresh)
    this.wireSessionEvents(fresh)
    await this.launch(fresh)
  }

  private notifyState(entry: MirrorEntry, payload: unknown): void {
    const { win, serial } = entry
    if (!win.isDestroyed()) {
      win.webContents.send('amoolink:mirror:state', { serial, payload })
    }
  }

  /** 处理来自投屏窗口的控制消息(渲染进程仅能触达自己 serial 的会话)。 */
  handleControl(sender: Electron.WebContents, serial: string, action: ControlAction): void {
    const entry = this.entries.get(serial)
    if (!entry) return
    if (sender.id !== entry.win.webContents.id) return // 安全校验:只接受本会话窗口的消息
    if (entry.state === 'stopped') return
    const s = entry.session
    this.maybeAutoBlackout(entry)
    switch (action.type) {
      case 'touch':
        s.injectTouch(action.action, action.pointerId ?? -1, action.x, action.y, action.pressure ?? 1)
        break
      case 'scroll':
        s.scroll(action.x, action.y, action.hUnits ?? 0, action.vUnits)
        break
      case 'key':
        s.injectKey(action.action, action.keycode)
        break
      case 'text':
        s.injectText(action.text)
        break
      case 'home': {
        s.goHome()
        // 兜底:部分机型(如 PZ261A 实测)对 keycode 注入不响应,追加 shell input
        void deviceService
          .getDeviceClient(serial)
          .then((client) => (client ? client.execOut('input keyevent HOME', 'utf8') : null))
          .catch(() => undefined)
        break
      }
      case 'back': {
        s.goBack()
        // 兜底:StepOS 实测过滤注入的 KEYCODE_BACK,shell input 有效
        void deviceService
          .getDeviceClient(serial)
          .then((client) => (client ? client.execOut('input keyevent 4', 'utf8') : null))
          .catch(() => undefined)
        break
      }
      case 'app-switch':
        s.appSwitch()
        break
      case 'volume-up':
        s.volumeUp()
        break
      case 'volume-down':
        s.volumeDown()
        break
      case 'screen-on':
        s.screenOn()
        break
      case 'rotate':
        s.rotateDevice()
        break
      case 'black-screen':
        this.setBlackScreen(serial, action.on)
        break
      case 'reset-video':
        s.resetVideo()
        break
      case 'notifications':
        s.expandNotifications()
        break
      case 'collapse':
        s.collapsePanels()
        break
      case 'screenshot': {
        const dataUrl = action.dataUrl as string
        void this.saveScreenshot(serial, dataUrl)
        break
      }
    }
  }

  private async saveScreenshot(serial: string, dataUrl: string): Promise<void> {
    try {
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const png = Buffer.from(base64, 'base64')
      // Electron 45 剪贴板为异步 W3C 风格 API
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
      const dir = settingsStore.get().files.downloadDir
      if (dir) {
        mkdirSync(dir, { recursive: true })
        const file = join(dir, `amoolink-${serial}-${Date.now()}.png`)
        writeFileSync(file, png)
        this.toast(serial, `截图已复制到剪贴板,已保存 ${file}`)
      } else {
        this.toast(serial, '截图已复制到剪贴板')
      }
    } catch (err) {
      this.toast(serial, `截图失败:${err instanceof Error ? err.message : err}`)
    }
  }

  private toast(serial: string, message: string): void {
    const entry = this.entries.get(serial)
    if (entry && !entry.win.isDestroyed()) {
      entry.win.webContents.send('amoolink:mirror:toast', { serial, payload: message })
    }
  }
}

/** 渲染进程可发送的控制动作(与 preload/renderer 类型保持一致)。 */
export type ControlAction =
  | { type: 'touch'; action: 0 | 1 | 2; x: number; y: number; pointerId?: bigint | number; pressure?: number }
  | { type: 'scroll'; x: number; y: number; vUnits: number; hUnits?: number }
  | { type: 'key'; action: 0 | 1; keycode: number }
  | { type: 'text'; text: string }
  | { type: 'home' }
  | { type: 'back' }
  | { type: 'app-switch' }
  | { type: 'volume-up' }
  | { type: 'volume-down' }
  | { type: 'screen-on' }
  | { type: 'rotate' }
  | { type: 'black-screen'; on: boolean }
  | { type: 'reset-video' }
  | { type: 'notifications' }
  | { type: 'collapse' }
  | { type: 'screenshot'; dataUrl: string }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const mirrorService = new MirrorService()
