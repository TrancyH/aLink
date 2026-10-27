import { execOut } from '@amoolink/adb'
import { deviceService } from './device-service'

export interface AppEntry {
  pkg: string
  label: string
}

/** 应用面板服务:第三方应用列表与快捷启动。 */
class AppsService {
  /** 列出第三方应用(pkg 列表;label 用 `pm list packages -f` 无法直接取,尝试 dumpsys 或退回 pkg 名)。 */
  async list(serial: string): Promise<AppEntry[]> {
    const client = await deviceService.getDeviceClient(serial)
    if (!client) throw new Error('设备不可用')
    const out = await execOut(client, 'pm list packages -3')
    const pkgs = out
      .split('\n')
      .map((l) => /^package:(.+)/.exec(l.trim())?.[1])
      .filter((p): p is string => !!p)
      .sort()
    return pkgs.map((pkg) => ({ pkg, label: pkg.split('.').slice(-1)[0] ?? pkg }))
  }

  /** 启动应用的 launcher 入口(等价点桌面图标)。 */
  async launch(serial: string, pkg: string): Promise<void> {
    const client = await deviceService.getDeviceClient(serial)
    if (!client) throw new Error('设备不可用')
    await execOut(client, `monkey -p '${pkg}' -c android.intent.category.LAUNCHER 1`)
  }
}

export const appsService = new AppsService()
