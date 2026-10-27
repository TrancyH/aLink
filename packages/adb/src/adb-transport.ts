import { createClient, type Client, type Device, type DeviceClient } from '@u4/adbkit'

export type { Client as AdbClient, Device, DeviceClient }
/** AmooLink 各处对设备客户端的引用统一走 adbkit 的 DeviceClient。 */
export type DeviceClientLike = DeviceClient

/** 一台被 adb server 识别的设备及其专属客户端。 */
export interface AdbDeviceHandle {
  serial: string
  state: string
  client: DeviceClient
}

/**
 * 连接本机 adb server(127.0.0.1:5037)的传输层。
 * adbkit 在首次连接失败时会尝试用 PATH 中的 adb(或 bin 选项)拉起 adb server。
 */
export class AdbTransport {
  private client: Client | null = null

  /** 获取 adb 客户端;createClient 为同步工厂,到 adb server 的连接按需惰性建立。 */
  async connect(): Promise<Client> {
    if (!this.client) {
      this.client = createClient({ host: '127.0.0.1', port: 5037 })
    }
    return this.client
  }

  /** 列出当前所有设备(state: device/offline/unauthorized/recovery/emulator)。 */
  async listDevices(): Promise<AdbDeviceHandle[]> {
    const client = await this.connect()
    const devices: Device[] = await client.listDevices()
    return devices.map((d) => ({
      serial: d.id,
      state: d.type,
      client: d.getClient(),
    }))
  }

  /** 取指定序列号的设备客户端;不存在时返回 null。 */
  async getDeviceClient(serial: string): Promise<DeviceClient | null> {
    const devices = await this.listDevices()
    return devices.find((d) => d.serial === serial)?.client ?? null
  }
}

/** 执行 shell 命令并以 UTF-8 字符串返回 stdout(execOut 走 raw 通道,适合 screencap 等二进制输出)。 */
export async function execOut(client: DeviceClient, command: string): Promise<string> {
  return await client.execOut(command, 'utf8')
}
