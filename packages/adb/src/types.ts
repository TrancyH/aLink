/** 设备屏幕信息(物理分辨率与密度)。 */
export interface DeviceScreen {
  width: number
  height: number
  density: number
}

/** 电池状态。level 为 0-100。 */
export interface DeviceBattery {
  level: number
  charging: boolean
}

/** /data 分区存储用量(字节)。 */
export interface DeviceStorage {
  totalBytes: number
  freeBytes: number
}

export type DeviceConnection = 'usb' | 'wifi' | 'unknown'

/** 桌面端视角的设备档案,由 DeviceManager 采集并缓存。 */
export interface DeviceInfo {
  serial: string
  state: string
  connection: DeviceConnection
  model?: string
  brand?: string
  manufacturer?: string
  codename?: string
  androidVersion?: string
  sdkInt?: number
  abi?: string
  screen?: DeviceScreen
  battery?: DeviceBattery
  storage?: DeviceStorage
  lastUpdated: number
}

export interface ShellResult {
  stdout: string
  exitCode: number | null
}
