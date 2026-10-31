/**
 * 伴侣 APK 通道服务(M5):配对管理、连接保活、事件扇出(通知/来电/剪贴板)、
 * 快捷回复 / 短信 / 通讯录 / 剪贴板请求代理;剪贴板历史本地 AES-GCM 加密存储。
 * 与 ADB 通道并存(docs/04 §6),本服务不横向依赖其他服务,事件经广播触达 UI。
 */
import { BrowserWindow, Notification } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import {
  CompanionClient,
  CompanionStore,
  decryptText,
  encryptText,
  type Frame,
  type PairedPhone,
} from '@amoolink/companion'

export interface CompanionPhoneStatus {
  id: string
  name: string
  connected: boolean
  pairedAt: number
  lastSeenAt?: number
}

export interface CompanionNotificationItem {
  key: string
  pkg: string
  title: string
  text: string
  postTimeMs: number
  replies: Array<{ actionIdx: number; inputKey: string; hints: string[] }>
}

class CompanionService {
  private store: CompanionStore | null = null
  private clients = new Map<string, CompanionClient>()
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 最近连接成功的主机(重连用)。 */
  private lastHost = new Map<string, string>()

  private ensureStore(): CompanionStore {
    if (!this.store) {
      this.store = new CompanionStore(join(userDataDir(), 'companion.json'))
      this.store.load()
    }
    return this.store
  }

  // ── 配对(M5-2)────────────────────────────────────────────────

  /** 发起配对:返回 SAS 供 UI 大字展示,用户与手机比对后在手机端点确认。 */
  async pair(ip: string, port: number, otp: string): Promise<{ sas: string; phoneName: string }> {
    if (!/^[A-Z0-9]{8}$/i.test(otp.trim())) throw new Error('配对码应为 8 位字母数字')
    const client = new CompanionClient(this.ensureStore(), (m) => console.log(`[companion] ${m}`))
    const progress = await client.startPairing(ip.trim(), port, otp.trim())
    this.lastHost.set('pending', ip.trim())
    // 后台等待手机确认;resolve 后存档案并转入 mTLS 连接
    void client
      .waitPaired()
      .then((entry) => {
        this.lastHost.set(entry.id, ip.trim())
        this.ensureStore().upsertPhone(entry)
        client.close()
        this.broadcast('amoolink:companion:paired', { id: entry.id, name: entry.name })
        this.connect(entry.id)
      })
      .catch((err: unknown) => {
        client.close()
        this.broadcast('amoolink:companion:pair-failed', {
          message: err instanceof Error ? err.message : String(err),
        })
      })
    return { sas: progress.sas, phoneName: progress.phoneName }
  }

  forget(id: string): void {
    this.disconnect(id)
    this.ensureStore().forget(id)
    this.broadcastStatus()
  }

  // ── 连接管理 ───────────────────────────────────────────────────

  /** 应用启动/配对完成后连接所有已配对手机。 */
  connectAll(): void {
    for (const phone of this.ensureStore().phones()) void this.connect(phone.id)
  }

  async connect(id: string): Promise<void> {
    if (this.clients.has(id)) return
    const entry = this.ensureStore().phone(id)
    if (!entry) return
    const host = this.lastHost.get(id)
    if (!host) return // 无最近地址,等待用户在配对面板输入或下次配对
    const client = new CompanionClient(this.ensureStore(), (m) => console.log(`[companion] ${m}`))
    client.on('event', (frame: Frame) => this.onEvent(id, frame))
    client.on('close', () => {
      this.clients.delete(id)
      this.broadcastStatus()
      this.scheduleReconnect(id)
    })
    try {
      await client.connect({ ...entry, host, port: 47888 })
      this.clients.set(id, client)
      this.ensureStore().touch(id)
      this.broadcastStatus()
    } catch (err) {
      this.clients.delete(id)
      this.scheduleReconnect(id)
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  private scheduleReconnect(id: string): void {
    if (this.reconnectTimers.has(id)) return
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(id)
      void this.connect(id).catch(() => undefined)
    }, 5000)
    this.reconnectTimers.set(id, timer)
  }

  private disconnect(id: string): void {
    const timer = this.reconnectTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(id)
    }
    this.clients.get(id)?.close()
    this.clients.delete(id)
  }

  status(): CompanionPhoneStatus[] {
    return this.ensureStore().phones().map((p) => ({
      id: p.id,
      name: p.name,
      connected: this.clients.has(p.id),
      pairedAt: p.pairedAt,
      lastSeenAt: p.lastSeenAt,
    }))
  }

  // ── 事件扇出(M5-3/M5-7)────────────────────────────────────────

  private onEvent(id: string, frame: Frame): void {
    switch (frame.type) {
      case 'notification': {
        const item: CompanionNotificationItem = {
          key: String(frame.key ?? ''),
          pkg: String(frame.pkg ?? ''),
          title: String(frame.title ?? ''),
          text: String(frame.text ?? ''),
          postTimeMs: Number(frame.postTimeMs ?? Date.now()),
          replies: Array.isArray(frame.replies)
            ? (frame.replies as Array<{ actionIdx: number; inputKey: string; hints?: string[] }>).map((r) => ({
                actionIdx: Number(r.actionIdx ?? 0),
                inputKey: String(r.inputKey ?? ''),
                hints: Array.isArray(r.hints) ? r.hints.map(String) : [],
              }))
            : [],
        }
        this.broadcast('amoolink:companion:notification', { phoneId: id, item })
        break
      }
      case 'call': {
        const state = String(frame.state ?? 'idle')
        if (state === 'ringing') {
          const name = frame.contactName ? String(frame.contactName) : '未知号码'
          new Notification({ title: '来电', body: name, silent: false }).show()
        }
        // 来电静音(M5-7):广播给投屏窗口暂停音频,挂断恢复
        this.broadcast('amoolink:companion:call', {
          phoneId: id,
          state,
          contactName: frame.contactName ? String(frame.contactName) : undefined,
        })
        break
      }
      case 'clipboard': {
        // M5-6:手机 → 电脑推送(焦点时机)入历史并同步系统剪贴板
        const text = String(frame.text ?? '')
        if (text) {
          this.appendHistory(id, text)
          void writeSystemClipboard(text)
          this.broadcast('amoolink:companion:clipboard', { phoneId: id, text })
        }
        break
      }
      default:
        break
    }
  }

  // ── 请求代理(快捷回复 / 短信 / 通讯录 / 剪贴板)──────────────────

  private requireClient(id: string): CompanionClient {
    const client = this.clients.get(id)
    if (!client) throw new Error('手机伴侣通道未连接')
    return client
  }

  async sendReply(phoneId: string, notificationKey: string, actionIdx: number, inputKey: string, text: string): Promise<void> {
    const res = await this.requireClient(phoneId).request('reply', { key: notificationKey, actionIdx, inputKey, text })
    if (res.ok !== true) throw new Error(String(res.error ?? '回复失败'))
  }

  async querySms(phoneId: string, max = 200): Promise<Array<{ id: number; address: string; body: string; dateMs: number; type: number }>> {
    const res = await this.requireClient(phoneId).request('sms_query', { max })
    return (res.items as Array<{ id: number; address: string; body: string; dateMs: number; type: number }>) ?? []
  }

  async queryContacts(phoneId: string, max = 500): Promise<Array<{ id: number; name: string; phones: string[] }>> {
    const res = await this.requireClient(phoneId).request('contacts_query', { max })
    return (res.items as Array<{ id: number; name: string; phones: string[] }>) ?? []
  }

  /** 电脑 → 手机:写手机剪贴板(M5-6 方向一)。 */
  async sendClipboard(text: string): Promise<void> {
    const client = this.firstConnected()
    if (!client) throw new Error('无已连接的伴侣手机')
    const res = await client.request('clipboard_set', { text })
    if (res.ok !== true) throw new Error(String(res.error ?? '发送失败'))
  }

  /** 手机 → 电脑:拉取手机当前剪贴板(焦点受限,失败时如实报错)。 */
  async pullClipboard(): Promise<string> {
    const client = this.firstConnected()
    if (!client) throw new Error('无已连接的伴侣手机')
    const res = await client.request('clipboard_get', {})
    if (res.ok !== true) throw new Error(`手机剪贴板不可读(${String(res.error ?? '未知')})——请打开手机上的 AmooLink 伴侣应用后重试`)
    return String(res.text ?? '')
  }

  /** M5-5:任意来源(amoolink://send、快捷键、右键服务)发送文本到手机。 */
  async sendTextToPhone(text: string): Promise<void> {
    await this.sendClipboard(text)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('amoolink:companion:toast', { message: `已发送到手机:${text.slice(0, 24)}${text.length > 24 ? '…' : ''}` })
    }
  }

  private firstConnected(): CompanionClient | null {
    for (const client of this.clients.values()) return client
    return null
  }

  // ── 剪贴板历史(M5-6:AES-256-GCM,按手机隔离)────────────────────

  history(phoneId: string): string[] {
    const entry = this.ensureStore().phone(phoneId)
    if (!entry?.historyKey) return []
    const key = Buffer.from(entry.historyKey, 'base64')
    if (key.length !== 32) return []
    const blob = readHistoryFile(phoneId)
    return blob
      .map((line) => decryptText(key, line))
      .filter((t): t is string => t !== null)
      .reverse()
  }

  private appendHistory(phoneId: string, text: string): void {
    const entry = this.ensureStore().phone(phoneId)
    if (!entry?.historyKey) return
    const key = Buffer.from(entry.historyKey, 'base64')
    if (key.length !== 32) return
    const lines = readHistoryFile(phoneId)
    lines.push(encryptText(key, text))
    writeHistoryFile(phoneId, lines.slice(-100))
  }

  // ── 广播 ───────────────────────────────────────────────────────

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  }

  broadcastStatus(): void {
    this.broadcast('amoolink:companion:status', this.status())
  }
}

function userDataDir(): string {
  // 独立于 electron app 模块,便于探针以 node 直跑(probe 用环境变量注入)
  const override = process.env['AMOOLINK_COMPANION_DIR']
  if (override) return override
  const home = process.env['HOME'] ?? '.'
  return join(home, '.amoolink')
}

function historyPath(phoneId: string): string {
  return join(userDataDir(), `companion-history-${phoneId}.json`)
}

function readHistoryFile(phoneId: string): string[] {
  try {
    if (!existsSync(historyPath(phoneId))) return []
    return JSON.parse(readFileSync(historyPath(phoneId), 'utf8')) as string[]
  } catch {
    return []
  }
}

function writeHistoryFile(phoneId: string, lines: string[]): void {
  mkdirSync(userDataDir(), { recursive: true })
  writeFileSync(historyPath(phoneId), JSON.stringify(lines), { mode: 0o600 })
}

async function writeSystemClipboard(text: string): Promise<void> {
  try {
    const { clipboard, ClipboardItem } = await import('electron')
    await clipboard.writeText(text)
    void ClipboardItem // Electron 45 文本写入仍可用同步 writeText
  } catch {
    // 剪贴板写入失败不阻断事件流
  }
}

export const companionService = new CompanionService()
