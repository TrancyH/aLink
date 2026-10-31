import { useEffect, useMemo, useState } from 'react'
import './Data.css'

interface SmsItem {
  id: number
  address: string
  body: string
  dateMs: number
  type: number
}

interface ContactItem {
  id: number
  name: string
  phones: string[]
}

interface CallItem {
  state: string
  contactName?: string
  ts: number
}

const TABS = [
  { key: 'sms', label: '短信' },
  { key: 'contacts', label: '通讯录' },
  { key: 'calls', label: '来电' },
] as const

type Tab = (typeof TABS)[number]['key']

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

/** 通讯录条目 → vCard 3.0。 */
function toVCard(items: ContactItem[]): string {
  return items
    .map((c) => {
      const tels = c.phones.map((p) => `TEL;TYPE=CELL:${p}`).join('\n')
      return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${c.name.replace(/[;,]/g, ' ')}`, tels, `UID:amoolink-${c.id}`, 'END:VCARD'].join('\n')
    })
    .join('\n')
}

/**
 * 数据页(M5-4/M5-7):经伴侣 APK 通道读取短信/通讯录(按需查询,不后台全量同步),
 * 通讯录可一键导出 vCard;来电事件实时记录。
 */
export default function DataPage() {
  const [tab, setTab] = useState<Tab>('sms')
  const [phoneId, setPhoneId] = useState('')
  const [phoneName, setPhoneName] = useState('')
  const [sms, setSms] = useState<SmsItem[]>([])
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [calls, setCalls] = useState<CallItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    void window.amoolink
      .companionStatus()
      .then((list) => {
        const online = list.find((p) => p.connected)
        if (online) {
          setPhoneId(online.id)
          setPhoneName(online.name)
        } else if (list.length > 0) {
          setPhoneId(list[0]?.id ?? '')
          setPhoneName(list[0]?.name ?? '')
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const off = window.amoolink.onCompanionEvent('amoolink:companion:call', (raw) => {
      const payload = raw as { phoneId: string; state: string; contactName?: string }
      setCalls((prev) => [{ state: payload.state, contactName: payload.contactName, ts: Date.now() }, ...prev].slice(0, 30))
    })
    return off
  }, [])

  const load = (which: Tab): void => {
    if (!phoneId || loading) return
    setLoading(true)
    setError('')
    const req = which === 'sms'
      ? window.amoolink.companionSms(phoneId).then((items) => setSms(items))
      : window.amoolink.companionContacts(phoneId).then((items) => setContacts(items))
    void req
      .catch((err: unknown) => setError(errText(err)))
      .finally(() => setLoading(false))
  }

  const exportVCard = (): void => {
    const blob = new Blob([toVCard(contacts)], { type: 'text/vcard' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `amoolink-contacts-${new Date().toISOString().slice(0, 10)}.vcf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || c.phones.some((p) => p.includes(q)))
  }, [contacts, search])

  const conversations = useMemo(() => {
    const byAddr = new Map<string, SmsItem[]>()
    for (const m of sms) {
      const list = byAddr.get(m.address) ?? []
      list.push(m)
      byAddr.set(m.address, list)
    }
    return [...byAddr.entries()]
      .map(([address, items]) => ({ address, items }))
      .sort((a, b) => (b.items[0]?.dateMs ?? 0) - (a.items[0]?.dateMs ?? 0))
  }, [sms])

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">
          数据
          <span className="count num">{phoneName ? `${phoneName}(伴侣通道)` : '未连接伴侣手机'}</span>
        </h1>
        <div className="spacer" />
        <div className="actions">
          {(tab === 'sms' || tab === 'contacts') && (
            <button type="button" className="btn" disabled={!phoneId || loading} onClick={() => load(tab)}>
              {loading ? '读取中…' : tab === 'sms' ? '读取短信' : '读取通讯录'}
            </button>
          )}
          {tab === 'contacts' && contacts.length > 0 && (
            <button type="button" className="btn" onClick={exportVCard} title={`导出 ${contacts.length} 条为 vCard`}>
              导出 vCard
            </button>
          )}
        </div>
      </header>

      <div className="page-body data-body">
        {error && (
          <div className="banner-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="data-tabs" role="group" aria-label="数据类型">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`data-tab${tab === t.key ? ' active' : ''}`}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!phoneId && (
          <div className="card data-empty">
            <p className="empty-title">未连接伴侣手机</p>
            <p className="empty-desc">在「设置 → 伴侣设备」完成配对后,可在此读取短信与通讯录</p>
          </div>
        )}

        {phoneId && tab === 'sms' && (
          <div className="card data-panel">
            {sms.length === 0 ? (
              <p className="data-hint">点右上「读取短信」按需加载(不在后台全量同步)</p>
            ) : (
              <ul className="sms-list">
                {conversations.map(({ address, items }) => {
                  const last = items[0]
                  if (!last) return null
                  return (
                    <li key={address} className="sms-thread">
                      <div className="sms-thread-head">
                        <span className="sms-address mono num">{address}</span>
                        <span className="sms-count num">{items.length} 条</span>
                        <span className="sms-time num">{timeOf(last.dateMs)}</span>
                      </div>
                      <p className="sms-snippet" title={last.body}>
                        {last.body}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {phoneId && tab === 'contacts' && (
          <div className="card data-panel">
            {contacts.length > 0 && (
              <input
                className="data-search"
                placeholder="搜索姓名或号码…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="通讯录搜索"
              />
            )}
            {contacts.length === 0 ? (
              <p className="data-hint">点右上「读取通讯录」按需加载;支持一键导出 vCard</p>
            ) : (
              <ul className="contact-list">
                {filteredContacts.map((c) => (
                  <li key={c.id} className="contact-row">
                    <span className="contact-name">{c.name}</span>
                    <span className="contact-phones mono num">{c.phones.join(' / ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {phoneId && tab === 'calls' && (
          <div className="card data-panel">
            {calls.length === 0 ? (
              <p className="data-hint">来电事件实时记录;来电脑端会弹系统提醒并自动静音投屏音频,挂断恢复</p>
            ) : (
              <ul className="call-list">
                {calls.map((c, i) => (
                  <li key={i} className="call-row">
                    <span className={`call-state ${c.state}`}>{c.state === 'ringing' ? '来电' : c.state === 'offhook' ? '通话中' : '挂断'}</span>
                    <span className="call-name">{c.contactName ?? '未知号码'}</span>
                    <span className="call-time num">{timeOf(c.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
