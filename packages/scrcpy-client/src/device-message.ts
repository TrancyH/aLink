import { DeviceMessageType } from './types.js'

/** 下行设备消息的解析结果。 */
export type DeviceMessage =
  | { type: 'clipboard'; text: string }
  | { type: 'ackSetClipboard'; sequence: bigint }
  | { type: 'uhidOutput'; id: number; data: Uint8Array }

/**
 * 设备消息增量解析器:喂入控制通道下行字节流,粘包安全。
 *
 * 布局(对照 scrcpy v3.3.1 DeviceMessageWriter,统一大端):
 * - CLIPBOARD(0): type(1) len(4) utf8(N)
 * - ACK_CLIPBOARD(1): type(1) sequence(8)
 * - UHID_OUTPUT(2): type(1) id(2) len(2) bytes(N)
 */
export class DeviceMessageParser {
  private buffer: Buffer = Buffer.alloc(0)

  constructor(private readonly onMessage: (msg: DeviceMessage) => void) {}

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    this.drain()
  }

  private drain(): void {
    for (;;) {
      if (this.buffer.length < 1) return
      const type = this.buffer.readUInt8(0)
      if (type === DeviceMessageType.CLIPBOARD) {
        if (this.buffer.length < 5) return
        const len = this.buffer.readUInt32BE(1)
        if (this.buffer.length < 5 + len) return
        const text = this.buffer.subarray(5, 5 + len).toString('utf8')
        this.buffer = this.buffer.subarray(5 + len)
        this.onMessage({ type: 'clipboard', text })
        continue
      }
      if (type === DeviceMessageType.ACK_CLIPBOARD) {
        if (this.buffer.length < 9) return
        const sequence = this.buffer.readBigUInt64BE(1)
        this.buffer = this.buffer.subarray(9)
        this.onMessage({ type: 'ackSetClipboard', sequence })
        continue
      }
      if (type === DeviceMessageType.UHID_OUTPUT) {
        if (this.buffer.length < 5) return
        const id = this.buffer.readInt16BE(1)
        const len = this.buffer.readUInt16BE(3)
        if (this.buffer.length < 5 + len) return
        const data = new Uint8Array(this.buffer.subarray(5, 5 + len))
        this.buffer = this.buffer.subarray(5 + len)
        this.onMessage({ type: 'uhidOutput', id, data })
        continue
      }
      // 未知类型:无法确定长度,丢弃整个缓冲防止错位(版本升级时需校准)
      this.buffer = Buffer.alloc(0)
      return
    }
  }
}
