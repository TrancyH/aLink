import { describe, expect, it } from 'vitest'
import {
  encodeInjectKeycode,
  encodeInjectText,
  encodeTouchEvent,
  encodeScrollEvent,
  encodeBackOrScreenOn,
  encodeExpandNotificationPanel,
  encodeCollapsePanels,
  encodeRotateDevice,
  encodeGetClipboard,
  encodeSetClipboard,
} from '../src/control-message.js'

/** 字节级断言:布局依据 Genymobile/scrcpy v3.3.1 ControlMessageReader.java(真机校准)。 */
describe('encodeInjectKeycode', () => {
  it('type=0,14 字节,action/keycode/repeat/metaState 大端', () => {
    const buf = encodeInjectKeycode(1, 3, 0, 0)
    expect(buf.length).toBe(14)
    expect([...buf.subarray(0, 2)]).toEqual([0, 1])
    expect(buf.readInt32BE(2)).toBe(3)
    expect(buf.readInt32BE(6)).toBe(0)
    expect(buf.readInt32BE(10)).toBe(0)
  })
})

describe('encodeInjectText', () => {
  it('type=1,len u32 + utf8', () => {
    const buf = encodeInjectText('hi')
    expect([...buf.subarray(0, 5)]).toEqual([1, 0, 0, 0, 2])
    expect(buf.subarray(5).toString('utf8')).toBe('hi')
  })
  it('中文按 utf8 字节数计长', () => {
    const buf = encodeInjectText('你好')
    expect(buf.readUInt32BE(1)).toBe(6)
  })
})

describe('encodeTouchEvent', () => {
  it('type=2,32 字节:像素坐标 + u16 屏幕 + 定点 pressure + 按钮', () => {
    const buf = encodeTouchEvent({
      action: 0,
      pointerId: -1,
      xPx: 600,
      yPx: 430,
      screenW: 1200,
      screenH: 2664,
      pressure: 1,
    })
    expect(buf.length).toBe(32)
    expect(buf[0]).toBe(2)
    expect(buf[1]).toBe(0) // DOWN
    expect(buf.readBigUInt64BE(2)).toBe(0xffffffffffffffffn) // 通用指针 -1
    expect(buf.readInt32BE(10)).toBe(600)
    expect(buf.readInt32BE(14)).toBe(430)
    expect(buf.readUInt16BE(18)).toBe(1200)
    expect(buf.readUInt16BE(20)).toBe(2664)
    expect(buf.readUInt16BE(22)).toBe(0xffff) // pressure=1
    expect(buf.readInt32BE(24)).toBe(1) // actionButton
    expect(buf.readInt32BE(28)).toBe(1) // buttons
  })

  it('UP 时 pressure 归零', () => {
    const buf = encodeTouchEvent({
      action: 1,
      pointerId: 0,
      xPx: 1,
      yPx: 2,
      screenW: 100,
      screenH: 200,
      pressure: 1,
    })
    expect(buf[1]).toBe(1)
    expect(buf.readUInt16BE(22)).toBe(0)
  })
})

describe('encodeScrollEvent', () => {
  it('type=3,21 字节,i16 定点(1 格 = 2048)', () => {
    const buf = encodeScrollEvent({
      xPx: 600,
      yPx: 1300,
      screenW: 1200,
      screenH: 2664,
      hUnits: 0,
      vUnits: -1.5,
    })
    expect(buf.length).toBe(21)
    expect(buf[0]).toBe(3)
    expect(buf.readInt32BE(1)).toBe(600)
    expect(buf.readUInt16BE(9)).toBe(1200)
    expect(buf.readUInt16BE(11)).toBe(2664)
    expect(buf.readInt16BE(13)).toBe(0)
    expect(buf.readInt16BE(15)).toBe(-3072) // -1.5 * 2048
    expect(buf.readInt32BE(17)).toBe(0)
  })
})

describe('简单消息', () => {
  it('BACK_OR_SCREEN_ON:2 字节', () => {
    expect([...encodeBackOrScreenOn(0)]).toEqual([4, 0])
    expect([...encodeBackOrScreenOn(1)]).toEqual([4, 1])
  })
  it('面板/旋转:1 字节', () => {
    expect(encodeExpandNotificationPanel()).toEqual(Buffer.from([5]))
    expect(encodeCollapsePanels()).toEqual(Buffer.from([7]))
    expect(encodeRotateDevice()).toEqual(Buffer.from([11]))
  })
  it('GET_CLIPBOARD:2 字节', () => {
    expect([...encodeGetClipboard(0)]).toEqual([8, 0])
  })
  it('SET_CLIPBOARD:14+N(type=9,paste 标志在 offset 9)', () => {
    const buf = encodeSetClipboard('ok', 7n, true)
    expect(buf.length).toBe(14 + 2)
    expect(buf[0]).toBe(9)
    expect(buf.readBigUInt64BE(1)).toBe(7n)
    expect(buf[9]).toBe(1)
    expect(buf.readUInt32BE(10)).toBe(2)
    expect(buf.subarray(14).toString('utf8')).toBe('ok')
  })
})
