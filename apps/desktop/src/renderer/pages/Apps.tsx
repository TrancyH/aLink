import { useEffect, useMemo, useState } from 'react'
import { useCurrentDevice } from '../bridge'
import { useToast } from '../components/Toast'
import { GridIcon, PhoneIcon, RefreshIcon, SearchIcon } from '../components/Icons'
import './Apps.css'

/** 应用条目(与 preload listApps 返回结构一致)。 */
interface AppEntry {
  pkg: string
  label: string
}

/** unknown 错误 → 可读文案(优先取 Error.message)。 */
function errText(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
  }
  return String(err)
}

/** pkg 末段作为卡片名称:com.android.settings → settings;无点号时原样。 */
function shortName(pkg: string): string {
  const segs = pkg.split('.').filter(Boolean)
  return segs.length > 0 ? segs[segs.length - 1] : pkg
}

/** 排序/展示名:优先应用标签,缺省回退 pkg 末段。 */
function displayName(app: AppEntry): string {
  return app.label.trim() !== '' ? app.label.trim() : shortName(app.pkg)
}

/** 头像底色:pkg 哈希到固定色板,避免随重排闪变。 */
const AVATAR_PALETTE = [
  '#7c86f4',
  '#55cf9a',
  '#f0b45a',
  '#f2818c',
  '#8fd0f2',
  '#c39df5',
  '#f29ac1',
  '#9fe0b8',
] as const

function avatarColor(pkg: string): string {
  let h = 0
  for (let i = 0; i < pkg.length; i += 1) {
    h = (h * 31 + pkg.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

/** 头像字母:标签首字符(缺省用 pkg 末段首字符),取首个 Unicode 码位以兼容中文。 */
function avatarLetter(app: AppEntry): string {
  const source = app.label.trim() !== '' ? app.label.trim() : shortName(app.pkg)
  const ch = Array.from(source)[0]
  return (ch ?? '?').toUpperCase()
}

/**
 * 应用面板页(批次2):列出当前设备应用,点击卡片启动。
 * 搜索为前端过滤(pkg / 标签);启动在后台生效,与是否投屏无关。
 */
export default function AppsPage() {
  const { serial, loading: devicesLoading, error: devicesError } = useCurrentDevice()
  const { toast, toastNode } = useToast()

  const [apps, setApps] = useState<AppEntry[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [query, setQuery] = useState('')
  /** 正在启动的 pkg;用于按钮 busy 态与并发防护。 */
  const [launching, setLaunching] = useState<string | null>(null)

  useEffect(() => {
    if (serial === null) return
    let disposed = false
    setListLoading(true)
    setListError(null)
    window.amoolink
      .listApps(serial)
      .then((list) => {
        if (disposed) return
        setApps(
          list
            .filter((a): a is AppEntry => typeof a?.pkg === 'string')
            .map((a) => ({ pkg: a.pkg, label: typeof a.label === 'string' ? a.label : '' })),
        )
      })
      .catch((err: unknown) => {
        if (!disposed) setListError(errText(err))
      })
      .finally(() => {
        if (!disposed) setListLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [serial, reloadNonce])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base =
      q === ''
        ? apps
        : apps.filter(
            (a) =>
              a.pkg.toLowerCase().includes(q) || a.label.toLowerCase().includes(q),
          )
    return [...base].sort((a, b) => displayName(a).localeCompare(displayName(b), 'zh-CN'))
  }, [apps, query])

  function handleLaunch(pkg: string): void {
    if (serial === null || launching !== null) return
    setLaunching(pkg)
    window.amoolink
      .launchApp(serial, pkg)
      .then(() => toast(`已启动 ${pkg}`))
      .catch((err: unknown) => toast(errText(err)))
      .finally(() => setLaunching(null))
  }

  const noDevice = serial === null && !devicesLoading && devicesError === null
  const showSkeleton = serial !== null && listLoading && apps.length === 0

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">
          应用
          {serial !== null && (
            <span className="count num">
              {listLoading && apps.length === 0 ? '加载中…' : `(${apps.length})`}
            </span>
          )}
        </h1>
        <div className="spacer" />
        <div className="actions">
          <div className="apps-search">
            <SearchIcon size={14} className="apps-search-icon" />
            <input
              type="text"
              value={query}
              placeholder="搜索应用或包名"
              aria-label="搜索应用"
              disabled={serial === null}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query !== '' && (
              <button
                type="button"
                className="apps-search-clear"
                onClick={() => setQuery('')}
                aria-label="清空搜索"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn icon-btn"
            disabled={serial === null || listLoading}
            onClick={() => setReloadNonce((n) => n + 1)}
            title="刷新应用列表"
            aria-label="刷新应用列表"
          >
            <RefreshIcon size={15} className={listLoading ? 'spin' : undefined} />
          </button>
        </div>
      </header>

      <div className="page-body apps-body">
        {devicesError && (
          <div className="banner-error" role="alert">
            <span className="num">设备服务异常:{devicesError}</span>
          </div>
        )}

        {noDevice ? (
          <div className="card apps-full-empty">
            <div className="empty-state">
              <span className="empty-icon">
                <PhoneIcon size={24} />
              </span>
              <p className="empty-title">未检测到已连接的设备</p>
              <p className="empty-desc">连接手机后,即可在这里查看并启动手机上的应用。</p>
            </div>
          </div>
        ) : showSkeleton ? (
          <div className="apps-grid" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="app-skel-tile card">
                <span className="skeleton app-skel-avatar" />
                <span className="skeleton app-skel-name" />
                <span className="skeleton app-skel-pkg" />
              </div>
            ))}
          </div>
        ) : listError !== null ? (
          <div className="card apps-full-empty">
            <div className="empty-state">
              <span className="empty-icon apps-error-icon">!</span>
              <p className="empty-title">应用列表读取失败</p>
              <p className="empty-desc">{listError}</p>
              <button
                type="button"
                className="btn"
                onClick={() => setReloadNonce((n) => n + 1)}
              >
                <RefreshIcon size={14} />
                重试
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card apps-full-empty">
            <div className="empty-state">
              <span className="empty-icon">
                <GridIcon size={24} />
              </span>
              <p className="empty-title">
                {query.trim() !== '' ? '没有匹配的应用' : '未获取到应用'}
              </p>
              <p className="empty-desc">
                {query.trim() !== ''
                  ? '换个关键词试试,支持按应用名或包名搜索。'
                  : '手机上没有可列举的启动类应用,或列表读取被系统限制。'}
              </p>
            </div>
          </div>
        ) : (
          <div className="apps-grid" role="list" aria-label="应用列表">
            {filtered.map((app) => (
              <button
                key={app.pkg}
                type="button"
                role="listitem"
                className={`app-card card${launching === app.pkg ? ' busy' : ''}`}
                title={`启动 ${app.pkg}`}
                disabled={launching === app.pkg}
                onClick={() => handleLaunch(app.pkg)}
              >
                <span className="app-avatar" style={{ background: avatarColor(app.pkg) }}>
                  {avatarLetter(app)}
                </span>
                <span className="app-name" title={displayName(app)}>
                  {shortName(app.pkg)}
                </span>
                <span className="app-pkg mono" title={app.pkg}>
                  {app.pkg}
                </span>
              </button>
            ))}
          </div>
        )}
        {toastNode}
      </div>
    </section>
  )
}
