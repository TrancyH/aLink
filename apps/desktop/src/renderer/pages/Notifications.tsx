import { useEffect, useState } from 'react'
import { useNotifications } from '../bridge'
import type { NotificationItem } from '../bridge'
import { BellIcon } from '../components/Icons'
import './Notifications.css'

/** 伴侣 APK 通道推送的通知(M5-3,实时、可快捷回复)。 */
interface CompanionNotification {
  key: string
  pkg: string
  title: string
  text: string
  postTimeMs: number
  replies: Array<{ actionIdx: number; inputKey: string; hints: string[] }>
}

function CompanionCard({
  item,
  phoneName,
  onReplied,
}: {
  item: CompanionNotification
  phoneName: string
  onReplied: (message: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const hue = hueOf(item.pkg)
  const time = timeOf(item.postTimeMs)
  const slot = item.replies[0]

  const send = (): void => {
    const text = draft.trim()
    if (!text || !slot || sending) return
    setSending(true)
    void window.amoolink
      .companionReply(phoneName, item.key, slot.actionIdx, slot.inputKey, text)
      .then(() => {
        setDraft('')
        onReplied('已回复')
      })
      .catch((err: unknown) => onReplied(err instanceof Error ? err.message : String(err)))
      .finally(() => setSending(false))
  }

  return (
    <li className="card notif-card companion-card">
      <span
        className="notif-app"
        style={{ background: `hsl(${hue} 42% 55% / 0.2)`, color: `hsl(${hue} 72% 74%)` }}
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
            {item.pkg} · 实时
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
        {slot && (
          <div className="companion-reply">
            {slot.hints.length > 0 && (
              <div className="companion-hints">
                {slot.hints.slice(0, 3).map((h) => (
                  <button key={h} type="button" className="companion-hint-chip" disabled={sending} onClick={() => setDraft(h)}>
                    {h}
                  </button>
                ))}
              </div>
            )}
            <input
              className="companion-reply-input"
              value={draft}
              placeholder="快捷回复…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send()
              }}
              aria-label="快捷回复"
            />
            <button type="button" className="btn btn-sm" disabled={!draft.trim() || sending} onClick={send}>
              {sending ? '发送中…' : '回复'}
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

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

function NotificationCard({
  item,
  muted,
  onToggleMute,
}: {
  item: NotificationItem
  muted: boolean
  onToggleMute: (pkg: string) => void
}) {
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
          <button
            type="button"
            className={`btn btn-ghost btn-sm notif-mute${muted ? ' active' : ''}`}
            title={muted ? `取消静音 ${item.pkg}(通知恢复同步)` : `静音 ${item.pkg}(不再弹该应用的通知)`}
            onClick={() => onToggleMute(item.pkg)}
          >
            {muted ? '🔔' : '🔕'}
          </button>
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
 * 通知页(M3):手机通知实时同步列表 + 按 App 免打扰(docs/03 §6)。
 * 数据来自 useNotifications(初始拉取 + onNotificationNew 置顶插入);
 * 「清空」仅清理前端本地列表;静音表持久化在设置,即时生效。
 */
export default function NotificationsPage() {
  const { notifications, clear } = useNotifications()
  const [mutedApps, setMutedApps] = useState<string[]>([])
  const [companionItems, setCompanionItems] = useState<CompanionNotification[]>([])
  const [replyNote, setReplyNote] = useState('')
  const [phoneId, setPhoneId] = useState('')

  useEffect(() => {
    void window.amoolink
      .companionStatus()
      .then((list) => {
        const online = list.find((p) => p.connected)
        if (online) setPhoneId(online.id)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const off = window.amoolink.onCompanionEvent('amoolink:companion:notification', (raw) => {
      const payload = raw as { phoneId: string; item: CompanionNotification }
      setPhoneId(payload.phoneId)
      setCompanionItems((prev) => {
        const next = prev.filter((p) => p.key !== payload.item.key)
        return [payload.item, ...next].slice(0, 60)
      })
    })
    return off
  }, [])

  useEffect(() => {
    let disposed = false
    void window.amoolink
      .listMutedApps()
      .then((list) => {
        if (!disposed) setMutedApps(list)
      })
      .catch(() => undefined)
    const unsubscribe = window.amoolink.onNotifyMutedChanged((list) => {
      if (!disposed) setMutedApps(list)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const toggleMute = (pkg: string): void => {
    void window.amoolink
      .setNotifyMuted(pkg, !mutedApps.includes(pkg))
      .then(setMutedApps)
      .catch(() => undefined)
  }

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">
          通知
          <span className="count num">共 {notifications.length + companionItems.length} 条</span>
        </h1>
        <div className="spacer" />
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={notifications.length === 0 && companionItems.length === 0}
            onClick={() => {
              clear()
              setCompanionItems([])
            }}
            title="清空当前列表(不影响手机端通知)"
          >
            清空
          </button>
        </div>
      </header>

      <div className="page-body notifications-body">
        <p className="hint">
          手机通知实时同步到电脑(基于 adb 轮询,约 2 秒延迟;点击系统通知可打开对应应用;🔕
          可按应用静音)。装有伴侣 App 的手机还会实时推送通知,并支持直接快捷回复。
        </p>

        {replyNote && <p className="hint companion-reply-note">{replyNote}</p>}

        {mutedApps.length > 0 && (
          <div className="card notif-muted-bar" aria-label="已静音应用">
            <span className="notif-muted-label">已静音</span>
            <div className="notif-muted-chips">
              {mutedApps.map((pkg) => (
                <button
                  key={pkg}
                  type="button"
                  className="notif-muted-chip"
                  title={`取消静音 ${pkg}`}
                  onClick={() => toggleMute(pkg)}
                >
                  🔔 {pkg}
                </button>
              ))}
            </div>
          </div>
        )}

        {companionItems.length > 0 && (
          <ul className="notif-list" aria-label="伴侣通道通知(实时)">
            {companionItems.map((item) => (
              <CompanionCard
                key={item.key}
                item={item}
                phoneName={phoneId}
                onReplied={setReplyNote}
              />
            ))}
          </ul>
        )}

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
              <NotificationCard
                key={n.key}
                item={n}
                muted={mutedApps.includes(n.pkg)}
                onToggleMute={toggleMute}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
