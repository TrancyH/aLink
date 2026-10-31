/**
 * 伴侣 APK 桌面端客户端 —— 反转架构(M5-2 实测适配):
 * StepOS 上手机入站 TLS 服务端被即刻掐断、AndroidKeystore 密钥不能参与 Conscrypt
 * TLS 握手(双向均然,直接 JCA 签名正常),故:
 *   - 桌面端运行 TLS 服务器(身份 = node-forge 自签证书),手机经「信箱端口」触发后
 *     出向回连(47888 信箱为纯 TCP,一行 CONNECT <ip> <port>);
 *   - 手机身份经协议内挑战-签名认证(auth_challenge/auth,Keystore 直接签名);
 *   - 配对信任锚不变:OTP 不上线 + SAS 目视比对 + 证书互钉扎。
 */
import { EventEmitter } from 'node:events'
import { connect as netConnect, isIPv4, type Socket } from 'node:net'
import { createServer as tlsCreateServer, type TLSSocket } from 'node:tls'
import { createVerify, randomBytes, X509Certificate } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { encodeFrame, FrameReader, COMPANION_PORT, type Frame } from './protocol.js'
import { sas6, transcript, fingerprintOfPem } from './crypto.js'
import type { CompanionStore, PairedPhone } from './store.js'

export interface PairingProgress {
  /** 双方各自计算、供用户目视比对的 6 位码。 */
  sas: string
  phoneName: string
  desktopFp: string
}

export type CompanionLog = (message: string) => void

/** 桌面端 TLS 服务器固定端口(实测 Mac 侧对 >50000 临时端口的入站连接会被静默丢弃)。 */
export const COMPANION_DESKTOP_PORT = 47889

export class CompanionClient extends EventEmitter {
  private socket: TLSSocket | null = null
  private server: ReturnType<typeof tlsCreateServer> | null = null
  private reader = new FrameReader()
  private nextId = 1
  private pending = new Map<number, { resolve: (f: Frame) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private closed = false
  private pendingPairPhoneCert = ''

  constructor(
    private readonly store: CompanionStore,
    private readonly log: CompanionLog = () => undefined,
  ) {
    super()
  }

  get connected(): boolean {
    return this.socket !== null && !this.closed
  }

  // ── 反转连接:桌面 TLS 服务器 + 信箱触发,等待手机回连 ─────────────

  /**
   * 搭建 TLS 服务器并触发手机回连;resolve 后连接已通过挑战-签名认证。
   * @param expectFp null = 配对模式(记录新证书);否则必须匹配该指纹。
   */
  private async awaitPhoneInbound(phoneIp: string, expectFp: string | null, timeoutMs: number): Promise<TLSSocket> {
    const identity = this.store.identity()
    const server = tlsCreateServer(
      { key: identity.keyPem, cert: identity.certPem },
      () => undefined, // 连接处理在 waitForPhone 中显式挂接
    )
    server.on('connection', () => this.log('server: raw connection 到达'))
    server.on('secureConnection', () => this.log('server: TLS 握手完成(secureConnection)'))
    server.on('tlsClientError', (err: Error) => this.log(`server: tlsClientError ${err.message}`))
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(COMPANION_DESKTOP_PORT, '0.0.0.0', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const listenPort = COMPANION_DESKTOP_PORT
    const advertiseIp = pickLanIp(phoneIp)
    if (!advertiseIp) throw new Error('无法确定本机局域网地址(检查 Wi-Fi)')
    this.log(`信箱触发 ${phoneIp}:${COMPANION_PORT} → CONNECT ${advertiseIp}:${listenPort}`)

    // 先挂"等待回连 + 挑战-签名认证"监听,再发信箱触发 ——
    // 手机回连可能快于本轮事件循环,顺序颠倒会错过 secureConnection(服务端握手完成事件)
    const inbound: Promise<TLSSocket> = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待手机回连超时')), timeoutMs)
      server.once('secureConnection', (s: TLSSocket) => {
        clearTimeout(timer)
        void this.handshakeAuth(s, expectFp).then(resolve, reject)
      })
      server.once('tlsClientError', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })
    })

    // 信箱触发:纯 TCP 一行指令(写完立即半关,由对端读到行后关闭)
    await new Promise<void>((resolve, reject) => {
      const mail = netConnect({ host: phoneIp, port: COMPANION_PORT, timeout: 6000 })
      mail.once('connect', () => {
        mail.write(`CONNECT ${advertiseIp} ${listenPort}\n`, () => {
          mail.end()
          resolve()
        })
      })
      mail.once('timeout', () => {
        mail.destroy()
        reject(new Error('连接手机信箱超时(检查 IP 与服务是否开启)'))
      })
      mail.once('error', (err: Error) => {
        mail.destroy()
        reject(err)
      })
    })

    const socket: TLSSocket = await inbound
    return socket
  }

  /** 协议内挑战-签名认证:验证手机证书(配对模式记录,常态必须匹配钉扎指纹)。 */
  private async handshakeAuth(socket: TLSSocket, expectFp: string | null): Promise<TLSSocket> {
    const nonce = randomBytes(32)
    const id = this.nextId++
    this.log('server: 发送 auth_challenge')
    const auth = await new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('手机认证超时')), 8000)
      const onFrame = (raw: Buffer): void => {
        try {
          const frames = new FrameReader().push(raw)
          for (const frame of frames) {
            if (frame.id === id && frame.type === 'auth') {
              clearTimeout(timer)
              socket.off('data', onFrame)
              resolve(frame)
            }
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      }
      socket.on('data', onFrame)
      socket.write(encodeFrame({ id, type: 'auth_challenge', nonce: nonce.toString('base64') }))
    })
    const certPem = String(auth.cert ?? '')
    const sigB64 = String(auth.sig ?? '')
    const phoneFp = fingerprintOfPem(certPem)
    if (expectFp !== null && phoneFp !== expectFp) {
      throw new Error('手机证书与配对档案不符')
    }
    // 验签:SHA256withECDSA(nonce)
    const verified = verifyEcdsa(certPem, nonce, Buffer.from(sigB64, 'base64'))
    if (!verified) throw new Error('手机签名验证失败')
    this.pendingPairPhoneCert = certPem
    this.attach(socket)
    return socket
  }

  // ── 配对(docs/04 §4.2:OTP 不上线,SAS 目视比对)──────────────────

  async startPairing(host: string, port: number, otp: string, timeoutMs = 20_000): Promise<PairingProgress> {
    if (!/^[A-Z0-9]{8}$/i.test(otp.trim())) throw new Error('配对码应为 8 位字母数字')
    const identity = this.store.identity()
    const socket = await this.awaitPhoneInbound(host, null, timeoutMs)
    const nonceD = randomBytes(16)
    const id = this.nextId++
    const response = await new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 pair_response 超时')), 8000)
      const onEvent = (frame: Frame): void => {
        if (frame.id === id && frame.type === 'pair_response') {
          clearTimeout(timer)
          this.off('event', onEvent)
          resolve(frame)
        }
      }
      this.on('event', onEvent)
      socket.write(encodeFrame({ id, type: 'pair_init', nonce: nonceD.toString('base64'), name: 'AmooLink-Desktop', caps: 0 }))
    })
    const phoneFp = fingerprintOfPem(this.pendingPairPhoneCert)
    const nonceP = Buffer.from(String(response.nonce ?? ''), 'base64')
    const tr = transcript(nonceD, nonceP, phoneFp, identity.fingerprint)
    return {
      sas: sas6(otp.trim().toUpperCase(), tr),
      phoneName: String(response.name ?? 'Android'),
      desktopFp: identity.fingerprint,
    }
  }

  /** 等待手机端用户确认(paired 事件)→ 组装配对档案(证书+historyKey)。 */
  async waitPaired(timeoutMs = 120_000): Promise<PairedPhone> {
    const paired = await new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待手机确认超时')), timeoutMs)
      const onEvent = (frame: Frame): void => {
        if (frame.type === 'paired') {
          clearTimeout(timer)
          this.off('event', onEvent)
          resolve(frame)
        } else if (frame.type === 'error') {
          clearTimeout(timer)
          this.off('event', onEvent)
          reject(new Error(String(frame.message ?? '配对被取消')))
        }
      }
      this.on('event', onEvent)
    })
    const certPem = this.pendingPairPhoneCert
    if (!certPem) throw new Error('配对上下文缺失')
    return {
      id: fingerprintOfPem(certPem),
      name: String(paired.name ?? 'Android'),
      certPem,
      historyKey: String(paired.historyKey ?? ''),
      pairedAt: Date.now(),
    }
  }

  // ── 常态连接 ─────────────────────────────────────────────────────

  async connect(entry: PairedPhone & { host?: string; port?: number }, timeoutMs = 15_000): Promise<void> {
    const socket = await this.awaitPhoneInbound(entry.host ?? '', entry.id, timeoutMs)
    this.startHeartbeat()
    void socket
  }

  // ── 请求/事件 ────────────────────────────────────────────────────

  request(type: string, payload: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<Frame> {
    const socket = this.socket
    if (!socket || this.closed) return Promise.reject(new Error('未连接'))
    const id = this.nextId++
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${type} 超时`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      socket.write(encodeFrame({ id, type, ...payload }))
    })
  }

  private attach(socket: TLSSocket): void {
    this.socket = socket
    this.closed = false
    socket.on('data', (chunk: Buffer) => {
      let frames: Frame[]
      try {
        frames = this.reader.push(chunk)
      } catch (err) {
        this.log(`帧解析失败:${err instanceof Error ? err.message : err}`)
        socket.destroy()
        return
      }
      for (const frame of frames) {
        if (typeof frame.id === 'number') {
          const waiter = this.pending.get(frame.id)
          if (waiter) {
            this.pending.delete(frame.id)
            clearTimeout(waiter.timer)
            waiter.resolve(frame)
            continue
          }
        }
        this.emit('event', frame)
      }
    })
    socket.on('error', (err: Error) => {
      this.log(`连接错误:${err.message}`)
      this.teardown()
    })
    socket.on('close', () => this.teardown())
  }

  private teardown(): void {
    if (this.closed && this.socket === null) return
    this.closed = true
    this.stopHeartbeat()
    this.socket = null
    this.server?.close()
    this.server = null
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('连接已断开'))
    }
    this.pending.clear()
    this.emit('close')
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      void this.request('ping', { t: Date.now() }, 8000).catch(() => undefined)
    }, 10_000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
  }

  close(): void {
    this.stopHeartbeat()
    this.socket?.destroy()
    this.server?.close()
    this.server = null
    this.teardown()
  }
}

/** 与目标同网段的本机局域网 IPv4(手机回连的通告地址)。 */
export function pickLanIp(targetIp: string): string | null {
  const prefix = targetIp.split('.').slice(0, 3).join('.')
  const sameSubnet: string[] = []
  const others: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal && isIPv4(ni.address)) {
        if (ni.address.startsWith(`${prefix}.`)) sameSubnet.push(ni.address)
        else others.push(ni.address)
      }
    }
  }
  return sameSubnet[0] ?? others[0] ?? null
}

/** SHA256withECDSA 验签(证书内公钥;Node 内置 X509 支持)。 */
export function verifyEcdsa(certPem: string, data: Buffer, sig: Buffer): boolean {
  try {
    const x509 = new X509Certificate(certPem)
    const verifier = createVerify('SHA256')
    verifier.update(data)
    return verifier.verify(x509.publicKey, sig)
  } catch {
    return false
  }
}
