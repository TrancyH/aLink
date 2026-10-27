import { EventEmitter } from 'node:events'
import { AdbTransport, type AdbDeviceHandle, type DeviceClientLike } from './adb-transport.js'
import { collectDeviceInfo } from './device-info.js'
import type { DeviceInfo } from './types.js'

/**
 * 设备管理器:轮询 adb server,维护设备档案缓存,变化时 emit('update', list)。
 *
 * 设计取舍(见 docs/02):M0 采用轮询(默认 2s)而非 adbkit tracker 事件——
 * 对本地 adb server 的 listDevices 请求成本极低,且对上游 API 差异完全免疫;
 * M1 若需要更低延迟可叠加 tracker 订阅。
 */
export class DeviceManager extends EventEmitter {
  private readonly transport = new AdbTransport()
  private readonly cache = new Map<string, DeviceInfo>()
  private timer: ReturnType<typeof setInterval> | null = null
  private polling: Promise<void> | null = null
  private lastSnapshot = ''

  constructor(private readonly intervalMs = 2000) {
    super()
  }

  async start(): Promise<void> {
    if (this.timer) return
    await this.poll()
    this.timer = setInterval(() => {
      void this.poll()
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  list(): DeviceInfo[] {
    return [...this.cache.values()]
  }

  get(serial: string): DeviceInfo | undefined {
    return this.cache.get(serial)
  }

  /** 立即刷新一次(带去重保护,并发调用共享同一次轮询)。 */
  async poll(): Promise<void> {
    if (this.polling) return this.polling
    this.polling = this.doPoll().finally(() => {
      this.polling = null
    })
    return this.polling
  }

  async getDeviceClient(serial: string): Promise<DeviceClientLike | null> {
    return this.transport.getDeviceClient(serial)
  }

  private async doPoll(): Promise<void> {
    let handles: AdbDeviceHandle[]
    try {
      handles = await this.transport.listDevices()
    } catch (err) {
      // adb server 不可达:清空缓存并广播,让 UI 呈现"服务不可用"
      if (this.cache.size > 0) {
        this.cache.clear()
        this.emitUpdate()
      }
      this.emit('error', err)
      return
    }

    const seen = new Set<string>()
    for (const handle of handles) {
      seen.add(handle.serial)
      if (handle.state !== 'device') {
        // 未授权/离线设备保留基础信息,不执行 shell 采集
        const existing = this.cache.get(handle.serial)
        this.cache.set(handle.serial, {
          serial: handle.serial,
          state: handle.state,
          connection: existing?.connection ?? 'unknown',
          lastUpdated: Date.now(),
        })
        continue
      }
      try {
        this.cache.set(handle.serial, await collectDeviceInfo(handle))
      } catch {
        // 单台设备采集失败不影响其他设备
      }
    }
    for (const serial of this.cache.keys()) {
      if (!seen.has(serial)) this.cache.delete(serial)
    }
    this.emitUpdate()
  }

  private emitUpdate(): void {
    const list = this.list()
    const snapshot = JSON.stringify(list)
    if (snapshot !== this.lastSnapshot) {
      this.lastSnapshot = snapshot
      this.emit('update', list)
    }
  }
}
