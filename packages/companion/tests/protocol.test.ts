import { describe, expect, it } from 'vitest'
import { encodeFrame, FrameReader, type Frame } from '../src/protocol.js'

describe('帧协议', () => {
  it('编码-解码往返', () => {
    const reader = new FrameReader()
    const frame: Frame = { id: 7, type: 'ping', t: 123 }
    const out = reader.push(encodeFrame(frame))
    expect(out).toEqual([frame])
  })

  it('任意切块重组', () => {
    const reader = new FrameReader()
    const a: Frame = { id: 1, type: 'clipboard_set', text: '你好 AmooLink' }
    const b: Frame = { id: null, type: 'notification', action: 'posted', key: '0|com.x|1|k' }
    const wire = Buffer.concat([encodeFrame(a), encodeFrame(b)])
    // 逐字节喂入
    let frames: Frame[] = []
    for (let i = 0; i < wire.length; i++) {
      frames = frames.concat(reader.push(wire.subarray(i, i + 1)))
    }
    expect(frames).toEqual([a, b])
  })

  it('非法帧长抛错', () => {
    const reader = new FrameReader()
    const bad = Buffer.alloc(4)
    bad.writeUInt32BE(0x7fffffff, 0)
    expect(() => reader.push(bad)).toThrow()
  })
})
