import { useEffect, useMemo, useState } from 'react'
import type { DeviceInfo } from '@amoolink/adb'
import { useDevices } from '../bridge'
import { useToast } from '../components/Toast'
import {
  BatteryIcon,
  BoltIcon,
  CameraIcon,
  CheckIcon,
  ConnectArtwork,
  CopyIcon,
  ChevronRightIcon,
  ImageIcon,
  LogoIcon,
  MonitorPlayIcon,
  PhoneIcon,
  RefreshIcon,
  UploadIcon,
  UsbIcon,
  WifiIcon,
} from '../components/Icons'
import './Devices.css'

/** unknown 错误 → 可读文案(优先取 Error.message)。 */
function errText(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
  }
  return String(err)
}

/** 字节数 → 人类可读(1 位小数)。 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** 连接状态 → 徽标文案与色调。 */
function statusOf(device: DeviceInfo): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  switch (device.state) {
    case 'device':
      return { label: '已连接', tone: 'success' }
    case 'unauthorized':
      return { label: '未授权', tone: 'warning' }
    case 'offline':
      return { label: '离线', tone: 'neutral' }
    default:
      return { label: device.state, tone: 'neutral' }
  }
}

function connectionLabel(connection: DeviceInfo['connection']): string {
  if (connection === 'usb') return 'USB'
  if (connection === 'wifi') return '无线'
  return '未知'
}

/** 端口字符串 → 1-65535 数字;非法时返回 null。 */
function parsePort(value: string): number | null {
  const t = value.trim()
  if (!/^\d{1,5}$/.test(t)) return null
  const n = Number.parseInt(t, 10)
  return n >= 1 && n <= 65535 ? n : null
}

/**
 * 设备管理页(T15):左侧设备卡片列表 + 右侧详情面板。
 */
export default function DevicesPage() {
  const { devices, loading, error, refresh } = useDevices()
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState(false)
  const { toast, toastNode } = useToast()

  // 选中设备优先;未选或已失联时回退到第一台。
  const activeDevice = useMemo(() => {
    return (
      devices.find((d) => d.serial === selectedSerial) ??
      (devices.length > 0 ? devices[0] : undefined)
    )
  }, [devices, selectedSerial])

  // 复位「已复制」标记
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(t)
  }, [copied])

  const handleRefresh = (): void => {
    setRefreshing(true)
    refresh()
    window.setTimeout(() => setRefreshing(false), 800)
  }

  const handleCopySerial = async (serial: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(serial)
      setCopied(true)
    } catch {
      toast('复制失败,请手动选择序列号复制')
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <LogoIcon size={20} className="header-logo" />
        <h1 className="page-title">
          设备
          <span className="count num">
            {loading ? '检测中…' : `${devices.length} 台设备`}
          </span>
        </h1>
        <div className="spacer" />
        <div className="actions">
          <button
            type="button"
            className="btn icon-btn"
            onClick={handleRefresh}
            title="刷新设备列表"
            aria-label="刷新设备列表"
          >
            <RefreshIcon size={15} className={refreshing ? 'spin' : undefined} />
          </button>
        </div>
      </header>

      <div className="page-body devices-body">
        {error && (
          <div className="banner-error" role="alert">
            <span className="num">设备服务异常:{error}</span>
          </div>
        )}

        {devices.length === 0 && !loading ? (
          <EmptyDevices
            usbSerial={
              devices.find((d) => d.connection === 'usb' && d.state === 'device')?.serial ?? null
            }
            toast={toast}
            onConnected={refresh}
          />
        ) : (
          <>
            {devices.length > 1 && (
              <div className="device-switcher" role="tablist" aria-label="已连接设备">
                {devices.map((d) => {
                  const st = statusOf(d)
                  const active = activeDevice?.serial === d.serial
                  return (
                    <button
                      key={d.serial}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`switch-chip${active ? ' active' : ''}`}
                      onClick={() => setSelectedSerial(d.serial)}
                    >
                      <span className={`switch-dot tone-${st.tone}`} />
                      {d.model ?? d.serial}
                    </button>
                  )
                })}
              </div>
            )}

            {loading && devices.length === 0 ? (
              <div className="card hero-card skeleton-card" aria-hidden />
            ) : activeDevice ? (
              <DeviceDetail
                device={activeDevice}
                toast={toast}
                copied={copied}
                onCopySerial={() => void handleCopySerial(activeDevice.serial)}
              />
            ) : null}
          </>
        )}

        {toastNode}
      </div>
    </section>
  )
}

/** 无设备空状态:插画 + USB 调试三步引导;「无线连接」在卡内切换到无线面板。 */
function EmptyDevices({
  usbSerial,
  toast,
  onConnected,
}: {
  usbSerial: string | null
  toast: (message: string) => void
  onConnected: () => void
}) {
  const [showWireless, setShowWireless] = useState(false)

  // 卡内切换视图(非弹窗):引导视图 ↔ 无线连接面板
  if (showWireless) {
    return (
      <div className="card empty-devices wireless-open">
        <WirelessPanel
          usbSerial={usbSerial}
          toast={toast}
          onConnected={onConnected}
          onBack={() => setShowWireless(false)}
        />
      </div>
    )
  }

  return (
    <div className="card empty-devices">
      <ConnectArtwork className="empty-artwork" />
      <h2 className="empty-title">未检测到设备</h2>
      <p className="empty-desc">用 USB 线连接手机并开启「USB 调试」,或使用无线方式连接。</p>

      <ol className="guide-steps">
        <li className="guide-step">
          <span className="guide-no num">1</span>
          <div>
            <p className="guide-title">开启开发者选项</p>
            <p className="guide-desc">设置 → 关于手机 → 连点 7 次「版本号」</p>
          </div>
        </li>
        <li className="guide-step">
          <span className="guide-no num">2</span>
          <div>
            <p className="guide-title">打开 USB 调试</p>
            <p className="guide-desc">设置 → 系统 → 开发者选项 → USB 调试</p>
          </div>
        </li>
        <li className="guide-step">
          <span className="guide-no num">3</span>
          <div>
            <p className="guide-title">连接并授权</p>
            <p className="guide-desc">USB 连接后在手机上允许「调试授权」弹窗</p>
          </div>
        </li>
      </ol>

      <button type="button" className="btn" onClick={() => setShowWireless(true)}>
        <WifiIcon size={15} />
        无线连接
      </button>
    </div>
  )
}

/* ---------- 无线连接面板(空状态卡内嵌) ---------- */

const WIRELESS_TABS = [
  { key: 'one-tap', label: '一键无线' },
  { key: 'pair', label: '配对连接' },
  { key: 'direct', label: '直接连接' },
] as const

type WirelessTab = (typeof WIRELESS_TABS)[number]['key']

/** 无线连接面板:一键无线 / 配对连接(Android 11+)/ 直接连接三种方式切换。 */
function WirelessPanel({
  usbSerial,
  toast,
  onConnected,
  onBack,
}: {
  usbSerial: string | null
  toast: (message: string) => void
  onConnected: () => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<WirelessTab>('one-tap')

  return (
    <div className="wireless-panel">
      <div className="wireless-head">
        <button type="button" className="btn btn-ghost btn-sm wireless-back" onClick={onBack}>
          <ChevronRightIcon size={13} className="flip-x" />
          返回
        </button>
        <h2 className="wireless-title">无线连接</h2>
      </div>
      <p className="wireless-lead">确保手机与电脑连接同一 Wi-Fi,选择一种方式连接。</p>

      <div className="wireless-tabs" role="group" aria-label="无线连接方式">
        {WIRELESS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`wireless-tab${tab === t.key ? ' active' : ''}`}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'one-tap' && (
        <OneTapPane usbSerial={usbSerial} toast={toast} onConnected={onConnected} />
      )}
      {tab === 'pair' && <PairPane toast={toast} onConnected={onConnected} />}
      {tab === 'direct' && <DirectPane toast={toast} onConnected={onConnected} />}
    </div>
  )
}

/** 方式一:一键无线 —— USB 在线时对当前 USB 设备执行 wirelessEnable。 */
function OneTapPane({
  usbSerial,
  toast,
  onConnected,
}: {
  usbSerial: string | null
  toast: (message: string) => void
  onConnected: () => void
}) {
  const [busy, setBusy] = useState(false)

  function handleEnable(): void {
    if (usbSerial === null || busy) return
    setBusy(true)
    window.amoolink
      .wirelessEnable(usbSerial)
      .then(({ ip }) => {
        toast(`已切换无线 ${ip}`)
        onConnected()
      })
      .catch((err: unknown) => toast(errText(err)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="wireless-pane">
      <p className="wireless-tip">手机用 USB 连接后点击,自动切换为无线。</p>
      {usbSerial !== null ? (
        <p className="wireless-meta mono num" title="当前 USB 设备序列号">
          {usbSerial}
        </p>
      ) : (
        <p className="wireless-note">需先用 USB 连接一次</p>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={usbSerial === null || busy}
        onClick={handleEnable}
      >
        <BoltIcon size={14} />
        {busy ? '切换中…' : '一键切换无线'}
      </button>
    </div>
  )
}

/** 方式二:配对连接(Android 11+)—— 先 6 位配对码配对,再输入连接端口连接。 */
function PairPane({
  toast,
  onConnected,
}: {
  toast: (message: string) => void
  onConnected: () => void
}) {
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [code, setCode] = useState('')
  const [pairing, setPairing] = useState(false)
  // 配对成功后进入第二步:连接(IP 预填配对 IP,端口默认清空)
  const [paired, setPaired] = useState(false)
  const [connectHost, setConnectHost] = useState('')
  const [connectPort, setConnectPort] = useState('')
  const [connecting, setConnecting] = useState(false)

  const codeValid = /^\d{6}$/.test(code)

  function handlePair(): void {
    const p = parsePort(port)
    if (host.trim() === '' || p === null || !codeValid || pairing) return
    setPairing(true)
    window.amoolink
      .wirelessPair(host.trim(), p, code)
      .then((res) => {
        if (res.ok) {
          toast('配对成功,请输入连接端口完成连接')
          setConnectHost(host.trim())
          setConnectPort('')
          setPaired(true)
        } else {
          toast(res.message || '配对失败')
        }
      })
      .catch((err: unknown) => toast(errText(err)))
      .finally(() => setPairing(false))
  }

  function handleConnect(): void {
    const p = parsePort(connectPort)
    if (connectHost.trim() === '' || p === null || connecting) return
    setConnecting(true)
    window.amoolink
      .wirelessConnect(connectHost.trim(), p)
      .then((res) => {
        if (res.ok) {
          toast('无线连接成功')
          onConnected()
        } else {
          toast(res.message || '连接失败')
        }
      })
      .catch((err: unknown) => toast(errText(err)))
      .finally(() => setConnecting(false))
  }

  return (
    <div className="wireless-pane">
      {!paired ? (
        <>
          <p className="wireless-tip">
            Android 11+ 打开「开发者选项 → 无线调试 → 使用配对码配对设备」,填入弹窗中的地址与配对码。
          </p>
          <div className="wireless-form">
            <label className="wireless-field wireless-field-ip">
              <span className="wireless-label">IP 地址</span>
              <input
                type="text"
                className="wireless-input mono"
                value={host}
                placeholder="192.168.1.100"
                onChange={(e) => setHost(e.target.value)}
              />
            </label>
            <label className="wireless-field">
              <span className="wireless-label">配对端口</span>
              <input
                type="text"
                className="wireless-input mono num"
                value={port}
                placeholder="如 38721"
                inputMode="numeric"
                onChange={(e) => setPort(e.target.value)}
              />
            </label>
            <label className="wireless-field">
              <span className="wireless-label">配对码</span>
              <input
                type="text"
                className="wireless-input mono num"
                value={code}
                placeholder="6 位数字"
                inputMode="numeric"
                maxLength={6}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={host.trim() === '' || parsePort(port) === null || !codeValid || pairing}
            onClick={handlePair}
          >
            {pairing ? '配对中…' : '配对'}
          </button>
        </>
      ) : (
        <>
          <p className="wireless-tip wireless-ok">
            <CheckIcon size={14} />
            配对成功,输入连接端口完成连接(端口见「无线调试」主界面,IP 可与配对时相同)。
          </p>
          <div className="wireless-form">
            <label className="wireless-field wireless-field-ip">
              <span className="wireless-label">IP 地址</span>
              <input
                type="text"
                className="wireless-input mono"
                value={connectHost}
                onChange={(e) => setConnectHost(e.target.value)}
              />
            </label>
            <label className="wireless-field">
              <span className="wireless-label">连接端口</span>
              <input
                type="text"
                className="wireless-input mono num"
                value={connectPort}
                placeholder="如 5555"
                inputMode="numeric"
                onChange={(e) => setConnectPort(e.target.value)}
              />
            </label>
          </div>
          <div className="wireless-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                connectHost.trim() === '' || parsePort(connectPort) === null || connecting
              }
              onClick={handleConnect}
            >
              {connecting ? '连接中…' : '连接'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPaired(false)}>
              重新配对
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** 方式三:直接连接 —— 输入 IP 与端口直接 wirelessConnect(需已完成过配对)。 */
function DirectPane({
  toast,
  onConnected,
}: {
  toast: (message: string) => void
  onConnected: () => void
}) {
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [busy, setBusy] = useState(false)

  function handleConnect(): void {
    const p = parsePort(port)
    if (host.trim() === '' || p === null || busy) return
    setBusy(true)
    window.amoolink
      .wirelessConnect(host.trim(), p)
      .then((res) => {
        if (res.ok) {
          toast('无线连接成功')
          onConnected()
        } else {
          toast(res.message || '连接失败')
        }
      })
      .catch((err: unknown) => toast(errText(err)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="wireless-pane">
      <p className="wireless-tip">
        手机「无线调试」主界面会显示 IP 与端口;已在本机配对过的设备可直接连接。
      </p>
      <div className="wireless-form">
        <label className="wireless-field wireless-field-ip">
          <span className="wireless-label">IP 地址</span>
          <input
            type="text"
            className="wireless-input mono"
            value={host}
            placeholder="192.168.1.100"
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
        <label className="wireless-field">
          <span className="wireless-label">端口</span>
          <input
            type="text"
            className="wireless-input mono num"
            value={port}
            placeholder="如 5555"
            inputMode="numeric"
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={host.trim() === '' || parsePort(port) === null || busy}
        onClick={handleConnect}
      >
        {busy ? '连接中…' : '连接'}
      </button>
    </div>
  )
}

/** 右侧详情面板。 */
function DeviceDetail({
  device,
  toast,
  copied,
  onCopySerial,
}: {
  device: DeviceInfo
  toast: (message: string) => void
  copied: boolean
  onCopySerial: () => void
}) {
  const status = statusOf(device)
  const battery = device.battery
  const storage = device.storage
  const usedBytes =
    storage !== undefined ? Math.max(0, storage.totalBytes - storage.freeBytes) : undefined
  const storagePct =
    storage !== undefined && storage.totalBytes > 0
      ? Math.min(100, Math.round(((usedBytes ?? 0) / storage.totalBytes) * 100))
      : 0

  return (
    <div className="card hero-card">
      <div className="hero-top">
        <span className="hero-phone">
          <PhoneIcon size={44} />
        </span>
        <div className="hero-id">
          <h2 className="hero-name">{device.model ?? device.serial}</h2>
          <div className="hero-tags">
            <span className={`badge badge-${status.tone}`}>{status.label}</span>
            <span className="hero-tag num">
              {device.connection === 'wifi' ? <WifiIcon size={13} /> : <UsbIcon size={13} />}
              {device.connection === 'wifi' ? '无线' : 'USB'}
            </span>
            {battery && (
              <span className="hero-tag num" title={`电量 ${battery.level}%`}>
                <BatteryIcon level={battery.level} charging={battery.charging} size={22} />
                {battery.level}%
              </span>
            )}
            <span className="hero-tag num">Android {device.androidVersion ?? '—'}</span>
          </div>
        </div>
      </div>

      <dl className="hero-grid">
        <div className="meta-row">
          <dt className="meta-label">品牌</dt>
          <dd className="meta-value">{device.brand ?? device.manufacturer ?? '—'}</dd>
        </div>
        <div className="meta-row">
          <dt className="meta-label">代号</dt>
          <dd className="meta-value mono">{device.codename ?? '—'}</dd>
        </div>
        <div className="meta-row">
          <dt className="meta-label">处理器架构</dt>
          <dd className="meta-value">{device.abi ?? '—'}</dd>
        </div>
        <div className="meta-row">
          <dt className="meta-label">Android 版本</dt>
          <dd className="meta-value num">
            {device.androidVersion ?? '—'}
            {device.sdkInt !== undefined && <span className="meta-sub">API {device.sdkInt}</span>}
          </dd>
        </div>
        <div className="meta-row">
          <dt className="meta-label">屏幕</dt>
          <dd className="meta-value num">
            {device.screen ? (
              <>
                {device.screen.width} × {device.screen.height}
                <span className="meta-sub">{device.screen.density || '—'} dpi</span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="meta-row">
          <dt className="meta-label">序列号</dt>
          <dd className="meta-value serial-cell">
            <span className="mono serial-text">{device.serial}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm copy-btn"
              onClick={onCopySerial}
              title="点击复制序列号"
            >
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              {copied ? '已复制' : '复制'}
            </button>
          </dd>
        </div>
      </dl>

      <div className="hero-meters">
        <div className="meter-block">
          <div className="meter-head">
            <span className="meter-title">
              电量
              {battery?.charging && <span className="charging-tag">充电中</span>}
            </span>
            <span className="num meter-value">
              {battery ? `${battery.level}%` : '—'}
            </span>
          </div>
          <div className="meter">
            <div
              className={`meter-fill${battery && battery.level <= 20 ? ' warning' : ' success'}`}
              style={{ width: battery ? `${Math.min(100, Math.max(0, battery.level))}%` : '0%' }}
            />
          </div>
        </div>

        <div className="meter-block">
          <div className="meter-head">
            <span className="meter-title">存储</span>
            <span className="num meter-value">
              {storage
                ? `已用 ${formatBytes(usedBytes ?? 0)} / ${formatBytes(storage.totalBytes)}`
                : '—'}
            </span>
          </div>
          <div className="meter">
            <div
              className="meter-fill"
              style={{ width: `${storagePct}%` }}
              data-pct={storagePct >= 90 ? 'high' : 'normal'}
            />
          </div>
          <p className="meter-foot num">
            {storage
              ? `剩余可用 ${formatBytes(storage.freeBytes)}`
              : '存储信息不可用'}
          </p>
        </div>
      </div>

      <div className="hero-actions">
        <button
          type="button"
          className="btn btn-primary hero-action main"
          disabled={device.state !== 'device'}
          title={
            device.state === 'device'
              ? '为这台设备打开投屏窗口'
              : '设备未就绪,暂无法投屏'
          }
          onClick={() => {
            void window.amoolink
              .startMirror(device.serial)
              .then((res) => {
                if (!res.ok) toast(`投屏启动失败:${device.model ?? device.serial}`)
              })
              .catch((err: unknown) => toast(`投屏启动失败:${errText(err)}`))
          }}
        >
          <MonitorPlayIcon size={15} />
          开始投屏
        </button>

        <button
          type="button"
          className="btn hero-action"
          disabled={device.state !== 'device'}
          title="截取手机当前屏幕,图片进入电脑剪贴板"
          onClick={() => {
            void window.amoolink
              .phoneScreenshot(device.serial)
              .then((res) => {
                toast(res.saved ? `已复制到电脑剪贴板,已保存 ${res.saved}` : '已复制到电脑剪贴板')
              })
              .catch((err: unknown) => toast(errText(err)))
          }}
        >
          <CameraIcon size={14} />
          手机截图
        </button>

        <button
          type="button"
          className="btn hero-action"
          disabled={device.state !== 'device'}
          title="读取手机剪贴板文本并同步到电脑"
          onClick={() => {
            void window.amoolink
              .pullPhoneClipboard(device.serial)
              .then((res) => {
                const text = res.text.trim()
                if (!text) {
                  toast('手机剪贴板为空')
                  return
                }
                toast(`已同步:${text.slice(0, 30)}`)
              })
              .catch((err: unknown) => toast(errText(err)))
          }}
        >
          <CopyIcon size={14} />
          拉取剪贴板
        </button>

        <button
          type="button"
          className="btn hero-action"
          disabled={device.state !== 'device'}
          title="把电脑剪贴板文本发送到手机"
          onClick={() => {
            void window.amoolink
              .pushClipboardToPhone(device.serial)
              .then(() => toast('电脑剪贴板已发送到手机'))
              .catch((err: unknown) => toast(errText(err)))
          }}
        >
          <UploadIcon size={14} />
          推送剪贴板
        </button>

        <button
          type="button"
          className="btn hero-action"
          disabled={device.state !== 'device'}
          title="把电脑剪贴板中的图片保存到手机相册"
          onClick={() => {
            void window.amoolink
              .sendClipboardImage(device.serial)
              .then((res) => toast(`已保存到手机相册 ${res.remotePath}`))
              .catch((err: unknown) => toast(errText(err)))
          }}
        >
          <ImageIcon size={14} />
          发图到手机
        </button>
      </div>
    </div>
  )
}
