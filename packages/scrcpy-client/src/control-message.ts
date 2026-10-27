import {
  ControlMessageType,
  CopyKey,
  AndroidKeycode,
  KeyAction,
  TouchAction,
} from './types.js'

export type AndroidKeycodeValue = (typeof AndroidKeycode)[keyof typeof AndroidKeycode]
export type KeyActionValue = (typeof KeyAction)[keyof typeof KeyAction]
export type TouchActionValue = (typeof TouchAction)[keyof typeof TouchAction]

/**
 * 控制消息编码 —— 按 scrcpy v3.3.1 服务端 ControlMessageReader 实测校准:
 * 坐标为设备像素(服务端按 screenSize 映射),统一大端。
 * 每个编码器注明字节布局,对照 Genymobile/scrcpy server 源码 ControlMessageReader.java。
 */

/** type(1) action(1) keycode(4) repeat(4) metaState(4) = 14 字节。 */
export function encodeInjectKeycode(
  action: KeyActionValue,
  keycode: AndroidKeycodeValue | number,
  repeat = 0,
  metaState = 0,
): Buffer {
  const buf = Buffer.alloc(14)
  buf.writeUInt8(ControlMessageType.INJECT_KEYCODE, 0)
  buf.writeUInt8(action, 1)
  buf.writeInt32BE(keycode, 2)
  buf.writeInt32BE(repeat, 6)
  buf.writeInt32BE(metaState, 10)
  return buf
}

/** type(1) len(4) utf8(N) = 5+N 字节。 */
export function encodeInjectText(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const buf = Buffer.alloc(5 + payload.length)
  buf.writeUInt8(ControlMessageType.INJECT_TEXT, 0)
  buf.writeUInt32BE(payload.length, 1)
  payload.copy(buf, 5)
  return buf
}

/**
 * type(1) action(1) pointerId(8) x(4像素) y(4像素) screenW(2) screenH(2)
 * pressure(2 定点 0~65535) actionButton(4) buttons(4) = 32 字节。
 * pointerId 按无符号 64 位写出(鼠标通用指针 -1 → 0xFFFFFFFFFFFFFFFF)。
 * 此布局已在真机(scrcpy-server v3.3.1)验证:点击注入成功。
 */
export function encodeTouchEvent(msg: {
  action: TouchActionValue
  pointerId: bigint | number
  xPx: number
  yPx: number
  screenW: number
  screenH: number
  /** 0~1,UP 时应为 0。 */
  pressure: number
  actionButton?: number
  buttons?: number
}): Buffer {
  const buf = Buffer.alloc(32)
  buf.writeUInt8(ControlMessageType.INJECT_TOUCH_EVENT, 0)
  buf.writeUInt8(msg.action, 1)
  buf.writeBigUInt64BE(BigInt.asUintN(64, BigInt(msg.pointerId)), 2)
  buf.writeInt32BE(Math.round(msg.xPx), 10)
  buf.writeInt32BE(Math.round(msg.yPx), 14)
  buf.writeUInt16BE(clampU16(msg.screenW), 18)
  buf.writeUInt16BE(clampU16(msg.screenH), 20)
  const pressure = msg.action === TouchAction.UP ? 0 : Math.min(Math.max(msg.pressure, 0), 1)
  buf.writeUInt16BE(Math.round(pressure * 0xffff), 22)
  buf.writeInt32BE(msg.actionButton ?? 1, 24)
  buf.writeInt32BE(msg.buttons ?? (msg.action === TouchAction.UP ? 0 : 1), 28)
  return buf
}

/**
 * type(1) x(4) y(4) screenW(2) screenH(2) hScroll(2 i16定点) vScroll(2 i16定点) buttons(4) = 21 字节。
 * 滚轮定点:i16 原始值 /32768×16 = 滚动单位数 → 1 个单位(一格)= 2048。
 * hUnits/vUnits 为滚动单位数(正=手指上滑内容向下,与鼠标滚轮下滚为负值习惯一致由调用方决定符号)。
 */
export function encodeScrollEvent(msg: {
  xPx: number
  yPx: number
  screenW: number
  screenH: number
  hUnits: number
  vUnits: number
  buttons?: number
}): Buffer {
  const buf = Buffer.alloc(21)
  buf.writeUInt8(ControlMessageType.INJECT_SCROLL_EVENT, 0)
  buf.writeInt32BE(Math.round(msg.xPx), 1)
  buf.writeInt32BE(Math.round(msg.yPx), 5)
  buf.writeUInt16BE(clampU16(msg.screenW), 9)
  buf.writeUInt16BE(clampU16(msg.screenH), 11)
  buf.writeInt16BE(clampI16(msg.hUnits * 2048), 13)
  buf.writeInt16BE(clampI16(msg.vUnits * 2048), 15)
  buf.writeInt32BE(msg.buttons ?? 0, 17)
  return buf
}

/** type(1) action(1) = 2 字节;action 0=返回,1=亮屏。 */
export function encodeBackOrScreenOn(action: 0 | 1): Buffer {
  const buf = Buffer.alloc(2)
  buf.writeUInt8(ControlMessageType.BACK_OR_SCREEN_ON, 0)
  buf.writeUInt8(action, 1)
  return buf
}

function encodeEmpty(type: number): Buffer {
  return Buffer.from([type])
}

export const encodeExpandNotificationPanel = () =>
  encodeEmpty(ControlMessageType.EXPAND_NOTIFICATION_PANEL)
export const encodeExpandSettingsPanel = () =>
  encodeEmpty(ControlMessageType.EXPAND_SETTINGS_PANEL)
export const encodeCollapsePanels = () => encodeEmpty(ControlMessageType.COLLAPSE_PANELS)
export const encodeRotateDevice = () => encodeEmpty(ControlMessageType.ROTATE_DEVICE)
export const encodeOpenHardKeyboardSettings = () =>
  encodeEmpty(ControlMessageType.OPEN_HARD_KEYBOARD_SETTINGS)

/** type(1) copyKey(1) = 2 字节。 */
export function encodeGetClipboard(copyKey: 0 | 1 | 2 = CopyKey.NONE): Buffer {
  const buf = Buffer.alloc(2)
  buf.writeUInt8(ControlMessageType.GET_CLIPBOARD, 0)
  buf.writeUInt8(copyKey, 1)
  return buf
}

/** type(1) on(1)=1 字节布尔:物理屏断电(off)但虚拟显示继续编码 —— 黑屏模式。 */
export function encodeSetDisplayPower(on: boolean): Buffer {
  return Buffer.from([ControlMessageType.SET_DISPLAY_POWER, on ? 1 : 0])
}

/**
 * type(1) sequence(8) paste(1) len(4) utf8(N)。
 * v3.3.1 的 SET_CLIPBOARD 含 paste 标志(服务端可顺带触发粘贴)。
 */
export function encodeSetClipboard(text: string, sequence = 0n, paste = false): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const buf = Buffer.alloc(14 + payload.length)
  buf.writeUInt8(ControlMessageType.SET_CLIPBOARD, 0)
  buf.writeBigUInt64BE(sequence, 1)
  buf.writeUInt8(paste ? 1 : 0, 9)
  buf.writeUInt32BE(payload.length, 10)
  payload.copy(buf, 14)
  return buf
}

function clampU16(v: number): number {
  return Math.min(Math.max(Math.round(v), 0), 0xffff)
}

function clampI16(v: number): number {
  return Math.min(Math.max(Math.round(v), -0x8000), 0x7fff)
}
