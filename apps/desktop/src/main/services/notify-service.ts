import { BrowserWindow, Notification } from 'electron'
import { execOut, parseNotifications, diffNewNotifications, isNoise, applyMuted, type NotificationItem } from '@amoolink/adb'
import { deviceService } from './device-service'
import { settingsStore } from '../settings-store'

/**
 * 通知同步(M3):轮询 `dumpsys notification --noredact`(默认 2s),
 * diff 出新增条目 → 系统通知 + 广播给通知页;点击系统通知启动对应 App。
 * 按 App 免打扰(docs/03 §6):静音表持久化在 settings.notifications.mutedApps,
 * 仅过滤 diff 结果与通知页列表 —— 基线保持完整,取消静音不会重放历史。
 *
 * 已知限制(docs/03 §6):免打扰状态下手机不展示的通知收不到;无法回复 —— 伴侣 APK(M5)解决。
 */
class NotifyService {
  private timer: ReturnType<typeof setInterval> | null = null
  private serial: string | null = null
  private lastItems: NotificationItem[] = []
  private readonly recent: NotificationItem[] = []

  start(serial: string, intervalMs = 2000): void {
    this.stop()
    this.serial = serial
    void this.poll() // 首轮立即建立基线
    this.timer = setInterval(() => {
      void this.poll()
    }, intervalMs)
  }

  stop(serial?: string): void {
    if (serial && this.serial !== serial) return
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.serial = null
  }

  /** 通知页列表:静音 App 的条目即时隐藏(历史保留在 recent,取消静音即恢复展示)。 */
  list(): NotificationItem[] {
    const muted = settingsStore.get().notifications.mutedApps
    return applyMuted([...this.recent].reverse().slice(0, 100), muted)
  }

  /** 当前静音表(通知页展示已静音 App)。 */
  mutedApps(): string[] {
    return [...settingsStore.get().notifications.mutedApps]
  }

  /** 按 App 静音开关(通知页 🔔/🔕 即时生效),变更广播给所有窗口。 */
  async setMuted(pkg: string, muted: boolean): Promise<string[]> {
    if (!/^[A-Za-z0-9._]+$/.test(pkg)) throw new Error(`非法包名:${pkg}`)
    const current = new Set(settingsStore.get().notifications.mutedApps)
    if (muted) current.add(pkg)
    else current.delete(pkg)
    const next = [...current].sort()
    await settingsStore.set({
      notifications: { enabled: settingsStore.get().notifications.enabled, mutedApps: next },
    })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('amoolink:notify:muted-changed', next)
    }
    return next
  }

  private async poll(): Promise<void> {
    const serial = this.serial
    if (!serial) return
    if (!settingsStore.get().notifications.enabled) return
    const client = await deviceService.getDeviceClient(serial)
    if (!client) {
      this.stop()
      return
    }
    try {
      const dump = await execOut(client, 'dumpsys notification --noredact')
      const items = parseNotifications(dump).filter((n) => !isNoise(n))
      // 基线保持完整列表,静音只作用于 diff 结果(取消静音不重放静音期历史)
      const muted = settingsStore.get().notifications.mutedApps
      const fresh = applyMuted(diffNewNotifications(this.lastItems, items), muted)
      this.lastItems = items
      for (const item of fresh) {
        this.push(item)
      }
    } catch {
      // 单次轮询失败跳过(dumpsys 偶发慢)
    }
  }

  private push(item: NotificationItem): void {
    this.recent.push(item)
    if (this.recent.length > 200) this.recent.shift()

    // 系统通知(点击启动对应 App)
    const notify = new Notification({
      title: item.title || item.pkg,
      body: item.text || '',
      silent: false,
    })
    notify.on('click', () => {
      void this.launchApp(item.pkg)
    })
    notify.show()

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('amoolink:notify:new', item)
    }
  }

  private async launchApp(pkg: string): Promise<void> {
    const serial = this.serial
    if (!serial) return
    const client = await deviceService.getDeviceClient(serial)
    if (!client) return
    // 启动该包的 launcher intent(等价点桌面图标)
    await execOut(client, `monkey -p '${pkg}' -c android.intent.category.LAUNCHER 1`).catch(() => undefined)
  }
}

export const notifyService = new NotifyService()
