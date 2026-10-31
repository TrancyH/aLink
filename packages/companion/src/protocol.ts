/**
 * AmooLink 伴侣协议 v1(与 apps/android-companion Proto.kt 对齐):
 * TLS 之上「4 字节大端长度 + UTF-8 JSON」分帧,双向对称;
 * id(数字/null)做请求-响应关联,id=null 为事件。
 */

export const COMPANION_PORT = 47888
export const MAX_FRAME = 1 << 20

/** 手机端能力位图(docs/04 §5.3 子集;APK v1)。 */
export const PHONE_CAPS = {
  CLIPBOARD_WRITE: 1n << 5n,
  CLIPBOARD_READ_FOCUS: 1n << 6n,
  NOTIF_READ: 1n << 8n,
  NOTIF_REPLY: 1n << 9n,
  SMS_READ: 1n << 10n,
  CONTACTS_READ: 1n << 12n,
  CALL_STATE: 1n << 13n,
} as const

export interface ReplySlot {
  actionIdx: number
  inputKey: string
  hints: string[]
}

/** 手机 → 桌面事件。 */
export type PhoneEvent =
  | { type: 'notification'; action: 'posted' | 'removed'; key: string; pkg: string; title: string; text: string; postTimeMs: number; replies: ReplySlot[] }
  | { type: 'call'; state: 'ringing' | 'offhook' | 'idle'; numberHash?: string; contactName?: string; ts: number }
  | { type: 'clipboard'; text: string; src: string; ts: number }
  | { type: 'paired'; name: string; historyKey: string; phoneCert: string }

/** 一条协议帧(帧头已剥离的 JSON 体)。 */
export interface Frame {
  id?: number | null
  type: string
  [key: string]: unknown
}

/** 编码一帧(4B 大端长度 + JSON)。 */
export function encodeFrame(frame: Frame): Buffer {
  const payload = Buffer.from(JSON.stringify(frame), 'utf8')
  if (payload.length > MAX_FRAME) throw new Error(`帧超长:${payload.length}`)
  const head = Buffer.alloc(4)
  head.writeUInt32BE(payload.length, 0)
  return Buffer.concat([head, payload])
}

/** 流式帧读取器:喂入任意切块,吐出完整帧。 */
export class FrameReader {
  private pending: Buffer = Buffer.alloc(0)

  /** 推入一段字节,返回解出的完整帧(可能为空数组)。 */
  push(chunk: Buffer): Frame[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    const frames: Frame[] = []
    for (;;) {
      if (this.pending.length < 4) break
      const len = this.pending.readUInt32BE(0)
      if (len <= 0 || len > MAX_FRAME) throw new Error(`非法帧长:${len}`)
      if (this.pending.length < 4 + len) break
      const payload = this.pending.subarray(4, 4 + len)
      this.pending = this.pending.subarray(4 + len)
      frames.push(JSON.parse(payload.toString('utf8')) as Frame)
    }
    return frames
  }
}
