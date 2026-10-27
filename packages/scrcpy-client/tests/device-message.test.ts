import { describe, expect, it } from 'vitest'
import { DeviceMessageParser, type DeviceMessage } from '../src/device-message.js'

function collect(): { messages: DeviceMessage[]; push: (chunk: Buffer) => void } {
  const messages: DeviceMessage[] = []
  const parser = new DeviceMessageParser((msg) => messages.push(msg))
  return { messages, push: (chunk: Buffer) => parser.push(chunk) }
}

describe('DeviceMessageParser', () => {
  it('解析 clipboard(v3: type=0,len u32 + utf8)', () => {
    const { messages, push } = collect()
    const text = Buffer.from('你好 scrcpy', 'utf8')
    const msg = Buffer.alloc(5 + text.length)
    msg.writeUInt8(0, 0)
    msg.writeUInt32BE(text.length, 1)
    text.copy(msg, 5)
    push(msg)
    expect(messages).toEqual([{ type: 'clipboard', text: '你好 scrcpy' }])
  })

  it('解析 ackSetClipboard(v3: type=1,sequence u64)', () => {
    const { messages, push } = collect()
    const msg = Buffer.alloc(9)
    msg.writeUInt8(1, 0)
    msg.writeBigUInt64BE(12345n, 1)
    push(msg)
    expect(messages).toEqual([{ type: 'ackSetClipboard', sequence: 12345n }])
  })

  it('粘包:一条消息拆两段送达仍完整解析', () => {
    const { messages, push } = collect()
    const text = Buffer.from('0123456789', 'utf8')
    const msg = Buffer.alloc(5 + text.length)
    msg.writeUInt8(0, 0)
    msg.writeUInt32BE(text.length, 1)
    text.copy(msg, 5)
    push(msg.subarray(0, 7))
    push(msg.subarray(7))
    expect(messages).toEqual([{ type: 'clipboard', text: '0123456789' }])
  })

  it('连发多条消息一次送达', () => {
    const { messages, push } = collect()
    const a = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 1]) // ack sequence=1
    const text = Buffer.from('hi')
    const b = Buffer.alloc(7)
    b.writeUInt8(0, 0)
    b.writeUInt32BE(2, 1)
    text.copy(b, 5)
    push(Buffer.concat([a, b]))
    expect(messages).toEqual([
      { type: 'ackSetClipboard', sequence: 1n },
      { type: 'clipboard', text: 'hi' },
    ])
  })
})
