export type VideoCodec = 'h264' | 'h265' | 'av1'
export type AudioCodec = 'aac' | 'opus' | 'flac'

/** scrcpy server 启动参数(经 app_process 传入,详见 docs/03)。 */
export interface ScrcpyOptions {
  logLevel: 'verbose' | 'debug' | 'info' | 'warn' | 'error'
  video: boolean
  audio: boolean
  control: boolean
  /** 最大边长像素,0 = 原始分辨率。 */
  maxSize: number
  videoBitRate: number
  maxFps: number
  videoCodec: VideoCodec
  audioCodec: AudioCodec
  sendDummyByte: boolean
  stayAwake: boolean
  powerOffScreenOnClose: boolean
}

export const DEFAULT_SCRCPY_OPTIONS: ScrcpyOptions = {
  logLevel: 'info',
  video: true,
  audio: true,
  control: true,
  maxSize: 0,
  videoBitRate: 8_000_000,
  maxFps: 0,
  videoCodec: 'h264',
  audioCodec: 'aac',
  sendDummyByte: true,
  stayAwake: false,
  powerOffScreenOnClose: false,
}

/** 首个 socket 下行的 64 字节设备元信息。 */
export interface DeviceMeta {
  deviceName: string
  width: number
  height: number
}

/** 坐标注入采用 0~65535 定点(scrpy 侧再映射回物理像素)。 */
export const COORDINATE_RANGE = 65535

/** 常用 Android keycode(注入按键用)。 */
export const AndroidKeycode = {
  BACK: 4,
  HOME: 3,
  APP_SWITCH: 187,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  MENU: 82,
  ENTER: 66,
  DEL: 67,
} as const

/** 按键动作。 */
export const KeyAction = { UP: 0, DOWN: 1 } as const

/** 触点动作。 */
export const TouchAction = { DOWN: 0, UP: 1, MOVE: 2 } as const

/** 复制键语义(GET_CLIPBOARD 的 copyKey):粘贴到手机剪贴板时可自动注册粘贴。 */
export const CopyKey = { NONE: 0, COPY: 1, CUT: 2 } as const

/** 下行设备消息类型(v3.3.1 实测:v3 重编,clipboard=0/ack=1/uhid=2,deviceName 消息已移除)。 */
export const DeviceMessageType = { CLIPBOARD: 0, ACK_CLIPBOARD: 1, UHID_OUTPUT: 2 } as const

/**
 * 上行控制消息类型(v3.3.1 实测,来自 jar 内 dex 常量)。
 * 注意:scrcpy v3 对 v1/v2 的编号整体重排 —— v2 的 TOUCH=4 在 v3 是 BACK_OR_SCREEN_ON,
 * 沿用旧编号会导致服务端解析错位崩溃(NegativeArraySizeException)。
 */
export const ControlMessageType = {
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATION_PANEL: 5,
  EXPAND_SETTINGS_PANEL: 6,
  COLLAPSE_PANELS: 7,
  GET_CLIPBOARD: 8,
  SET_CLIPBOARD: 9,
  SET_DISPLAY_POWER: 10,
  ROTATE_DEVICE: 11,
  UHID_CREATE: 12,
  UHID_INPUT: 13,
  UHID_DESTROY: 14,
  OPEN_HARD_KEYBOARD_SETTINGS: 15,
  START_APP: 16,
  RESET_VIDEO: 17,
} as const
