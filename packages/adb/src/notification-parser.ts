/** 通知条目(轮询解析结果)。 */
export interface NotificationItem {
  /** NotificationManager 的 key(0|pkg|id|tag|uid),diff 与去重主键。 */
  key: string
  pkg: string
  title: string
  text: string
  /** epoch 毫秒。 */
  whenMs: number
  importance: string
}

/**
 * 解析 `dumpsys notification --noredact` 输出(样本:StepX PZ261A / Android 16)。
 * 结构:每条以 `NotificationRecord(0x…: pkg=… importance=N key=…: Notification(…))` 起,
 * 其后数行内 `when=<ms>/<ms>`、extras 中 `android.title=String (X)`、`android.text=String (Y)`。
 * 解析器按 NotificationRecord 行切块,块内宽松正则取字段,缺字段容忍。
 */
export function parseNotifications(dump: string): NotificationItem[] {
  const items: NotificationItem[] = []
  const lines = dump.split('\n')
  let current: Partial<NotificationItem> | null = null

  for (const line of lines) {
    if (line.includes('NotificationRecord(')) {
      if (current?.key) items.push(current as NotificationItem)
      current = parseRecordHeader(line)
      continue
    }
    if (!current) continue
    if (current.whenMs === undefined) {
      const m = /when=(\d{13,})\//.exec(line)
      if (m?.[1]) current.whenMs = Number(m[1])
    }
    if (!current.title) {
      const m = /android\.title=(?:String|CharSequence) \((.*)\)$/.exec(line.trim())
      if (m?.[1] !== undefined) current.title = m[1]
    }
    if (!current.text) {
      const m = /android\.text=(?:String|CharSequence) \((.*)\)$/.exec(line.trim())
      if (m?.[1] !== undefined) current.text = m[1]
    }
    if (current.importance === undefined) {
      const m = /mImportance=(\w+)/.exec(line)
      if (m?.[1]) current.importance = m[1]
    }
  }
  if (current?.key) items.push(current as NotificationItem)
  return items
}

function parseRecordHeader(line: string): Partial<NotificationItem> {
  const pkg = /pkg=([\w.]+)/.exec(line)?.[1] ?? ''
  const key = /key=(0\|[^:]+):/.exec(line)?.[1] ?? ''
  const importance = /importance=(\d+)/.exec(line)?.[1] ?? ''
  return { pkg, key, importance, title: '', text: '', whenMs: undefined }
}

/** diff 两轮解析结果,返回新增的条目(按 key)。 */
export function diffNewNotifications(
  before: NotificationItem[],
  after: NotificationItem[],
): NotificationItem[] {
  const seen = new Set(before.map((n) => n.key))
  return after.filter((n) => !seen.has(n.key))
}

/** 过滤系统噪声(前台服务等常驻通知)。 */
export function isNoise(item: NotificationItem): boolean {
  if (item.pkg.startsWith('android')) return true
  if (item.importance === 'MIN') return true
  // 无标题也无正文的无声常驻项
  if (!item.title && !item.text) return true
  return false
}
