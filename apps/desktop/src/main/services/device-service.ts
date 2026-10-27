import { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import { DeviceManager, type DeviceClient, type DeviceInfo } from '@amoolink/adb'

/**
 * 设备服务(主进程单例):桥接 DeviceManager 与渲染进程。
 * 设备列表变化时向所有窗口广播 amoolink:device:changed。
 */
class DeviceService extends EventEmitter {
  private manager = new DeviceManager(2000)
  private started = false
  private lastSnapshot = ''

  async start(): Promise<void> {
    if (this.started) return
    this.manager.on('update', () => this.broadcast())
    this.manager.on('error', () => {
      // adb server 不可达:DeviceManager 已清空缓存并触发 update 广播,这里不再重复
    })
    await this.manager.start()
    this.started = true
  }

  stop(): void {
    this.manager.stop()
  }

  list(): DeviceInfo[] {
    return this.manager.list()
  }

  async refresh(): Promise<void> {
    await this.manager.poll()
  }

  /** 取设备的 adb 客户端(供 Mirror/Transfer 等服务使用)。 */
  async getDeviceClient(serial: string): Promise<DeviceClient | null> {
    return this.manager.getDeviceClient(serial)
  }

  private broadcast(): void {
    const devices = this.list()
    this.emit('update', devices)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('amoolink:device:changed', devices)
    }
  }

  /** 订阅设备列表变化(main 编排层使用,如通知随设备启停)。 */
  onUpdate(callback: (devices: DeviceInfo[]) => void): void {
    this.on('update', callback)
  }
}

export const deviceService = new DeviceService()
