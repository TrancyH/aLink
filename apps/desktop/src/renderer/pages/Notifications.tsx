import { useNotifications } from '../bridge'
import type { NotificationItem } from '../bridge'
import { BellIcon } from '../components/Icons'
import './Notifications.css'

/** pkg → 稳定色相(0-359):首字母圆形底色按包名哈希取色。 */
function hueOf(pkg: string): number {
  let h = 0
  for (let i = 0; i < pkg.length; i++) h = (h * 31 + pkg.charCodeAt(i)) >>> 0
  return h % 360
}

/** App 图标位占位字母:取包名最后一段的首字母。 */
function appInitial(pkg: string): string {
  const last = pkg.split('.').filter(Boolean).pop() ?? pkg
  return (last[0] ?? '?').toUpperCase()
}

/** 时间戳 → HH:mm;完整日期时间放 title。 */
function timeOf(ms: number): { label: string; full: string } {
  const d = new Date(ms)
  return {
    label: d.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }),
    full: d.toLocaleString('zh-CN', { hour12: false }),
  }
}

function NotificationCard({ item }: { item: NotificationItem }) {
  const hue = hueOf(item.pkg)
  const time = timeOf(item.whenMs)
  return (
    <li className={`card notif-card${item.fresh ? ' is-new' : ''}`}>
      <span
        className="notif-app"
        style={{
          background: `hsl(${hue} 42% 55% / 0.2)`,
          color: `hsl(${hue} 72% 74%)`,
        }}
        aria-hidden="true"
      >
        {appInitial(item.pkg)}
      </span>
      <div className="notif-main">
        <div className="notif-head">
          <span className="notif-title" title={item.title}>
            {item.title || '无标题'}
          </span>
          <span className="notif-pkg" title={item.pkg}>
            {item.pkg}
          </span>
          <span className="notif-time num" title={time.full}>
            {time.label}
          </span>
        </div>
        {item.text && (
          <p className="notif-text" title={item.text}>
            {item.text}
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * 通知页(M3):手机通知实时同步列表。
 * 数据来自 useNotifications(初始拉取 + onNotificationNew 置顶插入);
 * 「清空」仅清理前端本地列表。
 */
export default function NotificationsPage() {
  const { notifications, clear } = useNotifications()

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">
          通知
          <span className="count num">共 {notifications.length} 条</span>
        </h1>
        <div className="spacer" />
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={notifications.length === 0}
            onClick={clear}
            title="清空当前列表(不影响手机端通知)"
          >
            清空
          </button>
        </div>
      </header>

      <div className="page-body notifications-body">
        <p className="hint">
          手机通知实时同步到电脑(基于 adb 轮询,约 2 秒延迟;点击系统通知可打开对应应用)
        </p>

        {notifications.length === 0 ? (
          <div className="card notif-empty">
            <div className="empty-state">
              <span className="empty-icon">
                <BellIcon size={24} />
              </span>
              <p className="empty-title">暂无同步通知</p>
              <p className="empty-desc">手机来新通知后会出现在这里</p>
            </div>
          </div>
        ) : (
          <ul className="notif-list" aria-label="通知列表">
            {notifications.map((n) => (
              <NotificationCard key={n.key} item={n} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
