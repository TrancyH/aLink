import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../main/settings-store'
import { ChevronDownIcon } from '../components/Icons'
import './Settings.css'

/* ---------- 表单状态(与主进程 AppSettings 的 UI 侧映射) ---------- */

type ClipboardMode = 'auto' | 'manual'
type Language = 'zh-CN'

/** UI 侧表单值:码率以 Mbps 表示,持久化时换算为 bps。 */
interface SettingsForm {
  autoStart: boolean
  tray: boolean
  language: Language
  notificationsEnabled: boolean
  notesAutoSync: boolean
  maxSize: number // 0 = 原始,720 / 1080 / 1440
  bitrateMbps: number
  maxFps: number // 0 = 最高
  stayAwake: boolean
  uploadDir: string
  autoBlackScreen: boolean
  audio: boolean
  videoCodec: 'h264' | 'h265'
  downloadDir: string
  transferConcurrency: number
  clipboardMode: ClipboardMode
  keepHistory: boolean
  /** 通知按 App 静音表(通知页维护,此处仅透传防止保存时丢字段)。 */
  mutedApps: string[]
}

const DEFAULT_FORM: SettingsForm = {
  autoStart: false,
  tray: true,
  language: 'zh-CN',
  notificationsEnabled: true,
  notesAutoSync: true,
  maxSize: 0,
  bitrateMbps: 8,
  maxFps: 0,
  stayAwake: true,
  uploadDir: '/sdcard/Download',
  autoBlackScreen: true,
  audio: true,
  videoCodec: 'h264',
  downloadDir: '',
  transferConcurrency: 2,
  clipboardMode: 'manual',
  keepHistory: false,
  mutedApps: [],
}

const RESOLUTION_OPTIONS = [
  { value: 0, label: '原始分辨率' },
  { value: 720, label: '720p' },
  { value: 1080, label: '1080p' },
  { value: 1440, label: '2K' },
]

const FPS_OPTIONS = [
  { value: 0, label: '最高' },
  { value: 30, label: '30 帧' },
  { value: 60, label: '60 帧' },
]

const BITRATE_MIN = 2
const BITRATE_MAX = 40
const PERSIST_DEBOUNCE_MS = 500

/** AppSettings → 表单值;码率换算为 Mbps 并夹到滑杆范围。 */
function fromSettings(s: AppSettings): SettingsForm {
  return {
    autoStart: s.general.autoStart,
    tray: s.general.tray,
    language: s.general.language,
    notificationsEnabled: s.notifications.enabled,
    notesAutoSync: s.notes.autoSync,
    maxSize: s.mirror.maxSize,
    bitrateMbps: Math.min(
      BITRATE_MAX,
      Math.max(BITRATE_MIN, Math.round(s.mirror.bitrate / 1_000_000)),
    ),
    maxFps: s.mirror.maxFps,
    stayAwake: s.mirror.stayAwake,
    uploadDir: s.mirror.uploadDir,
    autoBlackScreen: s.mirror.autoBlackScreen,
    audio: s.mirror.audio,
    videoCodec: s.mirror.videoCodec,
    downloadDir: s.files.downloadDir,
    transferConcurrency: s.transfers.concurrency,
    clipboardMode: s.privacy.clipboardSyncMode,
    keepHistory: s.privacy.keepHistory,
    mutedApps: s.notifications.mutedApps,
  }
}

/** 表单值 → 持久化 patch;码率换算为 bps。 */
function toPatch(f: SettingsForm): Partial<AppSettings> {
  return {
    general: { language: f.language, autoStart: f.autoStart, tray: f.tray },
    notifications: { enabled: f.notificationsEnabled, mutedApps: f.mutedApps },
    notes: { autoSync: f.notesAutoSync },
    mirror: {
      maxSize: f.maxSize,
      bitrate: f.bitrateMbps * 1_000_000,
      maxFps: f.maxFps,
      stayAwake: f.stayAwake,
      uploadDir: f.uploadDir || '/sdcard/Download',
      autoBlackScreen: f.autoBlackScreen,
      audio: f.audio,
      videoCodec: f.videoCodec,
    },
    files: { downloadDir: f.downloadDir },
    transfers: { concurrency: f.transferConcurrency },
    privacy: { clipboardSyncMode: f.clipboardMode, keepHistory: f.keepHistory },
  }
}

/* ---------- 受控小组件 ---------- */

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  )
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          disabled={opt.disabled}
          className={`segment${value === opt.value ? ' active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** 设置行:左侧标签 + 说明,右侧控件。 */
function SettingRow({
  title,
  desc,
  children,
}: {
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <p className="setting-title">{title}</p>
        {desc && <p className="setting-desc">{desc}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

/**
 * 设置页(T17):分组表单。挂载时从主进程读取持久化设置,
 * 任一变更后 500ms 防抖写回(userData/settings.json)。
 */
export default function SettingsPage() {
  const [form, setForm] = useState<SettingsForm>(DEFAULT_FORM)
  // 最近一次已持久化的表单快照;null 表示初始加载尚未完成,期间不触发写回。
  const savedSnapshotRef = useRef<string | null>(null)

  // 初始化:读取持久化设置(失败回退默认值,仍允许编辑)
  useEffect(() => {
    let disposed = false
    void window.amoolink
      .getSettings()
      .then((s) => {
        if (disposed) return
        const f = fromSettings(s)
        savedSnapshotRef.current = JSON.stringify(f)
        setForm(f)
      })
      .catch(() => {
        if (!disposed) savedSnapshotRef.current = JSON.stringify(DEFAULT_FORM)
      })
    return () => {
      disposed = true
    }
  }, [])

  // 通知页的按 App 静音即时同步进表单(透传字段),避免本页保存时写回旧静音表;
  // 表单与快照因此不一致,会随 500ms 防抖自然持久化
  useEffect(() => {
    const unsubscribe = window.amoolink.onNotifyMutedChanged((mutedApps) => {
      setForm((prev) => ({ ...prev, mutedApps }))
    })
    return unsubscribe
  }, [])

  // 变更后 500ms 防抖持久化;与最近快照一致时跳过,失败静默。
  useEffect(() => {
    if (savedSnapshotRef.current === null) return
    const snapshot = JSON.stringify(form)
    if (snapshot === savedSnapshotRef.current) return
    const timer = window.setTimeout(() => {
      void window.amoolink
        .setSettings(toPatch(form))
        .then((next) => {
          savedSnapshotRef.current = JSON.stringify(fromSettings(next))
        })
        .catch(() => {
          /* 写入失败静默,保留表单当前值 */
        })
    }, PERSIST_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [form])

  function update<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const bitratePct = ((form.bitrateMbps - BITRATE_MIN) / (BITRATE_MAX - BITRATE_MIN)) * 100

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">设置</h1>
        <div className="spacer" />
      </header>

      <div className="page-body settings-body">
        <p className="hint">更改即时保存 —— 修改后自动写入本地配置,无需手动确认。</p>

        {/* 通用 */}
        <section className="card settings-group">
          <h2 className="settings-group-title">通用</h2>
          <SettingRow title="开机自启" desc="登录系统后自动启动 AmooLink(M2 生效)">
            <Switch
              label="开机自启"
              checked={form.autoStart}
              onChange={(v) => update('autoStart', v)}
            />
          </SettingRow>
          <SettingRow title="托盘常驻" desc="关闭窗口后保留在系统托盘,继续接收同步数据(M2 生效)">
            <Switch
              label="托盘常驻"
              checked={form.tray}
              onChange={(v) => update('tray', v)}
            />
          </SettingRow>
          <SettingRow title="通知同步" desc="开启后手机通知实时同步到「通知」页(基于 adb 轮询,约 2 秒延迟)">
            <Switch
              label="通知同步"
              checked={form.notificationsEnabled}
              onChange={(v) => update('notificationsEnabled', v)}
            />
          </SettingRow>

          <SettingRow title="自动同步笔记" desc="手机连接电脑后自动双向同步「笔记」内容(关闭后仅手动点「立即同步」)">
            <Switch
              label="自动同步笔记"
              checked={form.notesAutoSync}
              onChange={(v) => update('notesAutoSync', v)}
            />
          </SettingRow>
          <SettingRow title="语言" desc="界面显示语言">
            <div className="select-wrap">
              <select
                className="select"
                value={form.language}
                onChange={(e) => update('language', e.target.value as Language)}
                aria-label="语言"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en" disabled>
                  English(M2 支持)
                </option>
              </select>
              <ChevronDownIcon size={13} className="select-chevron" />
            </div>
          </SettingRow>
        </section>

        {/* 投屏 */}
        <section className="card settings-group">
          <h2 className="settings-group-title">投屏</h2>
          <SettingRow title="分辨率" desc="投屏画面的输出分辨率,原始分辨率最清晰">
            <div className="select-wrap">
              <select
                className="select"
                value={form.maxSize}
                onChange={(e) => update('maxSize', Number(e.target.value))}
                aria-label="投屏分辨率"
              >
                {RESOLUTION_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon size={13} className="select-chevron" />
            </div>
          </SettingRow>
          <div className="setting-row">
            <div className="setting-text">
              <p className="setting-title">码率</p>
              <p className="setting-desc">码率越高画质越好,占用带宽越大</p>
            </div>
            <div className="setting-control range-control">
              <span className="range-value num">{form.bitrateMbps} Mbps</span>
              <input
                type="range"
                className="range"
                min={BITRATE_MIN}
                max={BITRATE_MAX}
                step={1}
                value={form.bitrateMbps}
                onChange={(e) => update('bitrateMbps', Number(e.target.value))}
                aria-label="投屏码率"
                style={{
                  background: `linear-gradient(to right, var(--color-accent) ${bitratePct}%, var(--color-surface-active) ${bitratePct}%)`,
                }}
              />
              <span className="range-bounds num">
                <span>{BITRATE_MIN}</span>
                <span>{BITRATE_MAX}</span>
              </span>
            </div>
          </div>
          <SettingRow title="帧率" desc="帧率越高画面越流畅,功耗越高">
            <Segmented
              ariaLabel="投屏帧率"
              value={form.maxFps}
              onChange={(v) => update('maxFps', v)}
              options={FPS_OPTIONS}
            />
          </SettingRow>
          <SettingRow title="亮屏保持" desc="投屏期间保持手机唤醒不自动息屏(默认开启;手动息屏也会被看护自动唤醒)">
            <Switch
              label="亮屏保持"
              checked={form.stayAwake}
              onChange={(v) => update('stayAwake', v)}
            />
          </SettingRow>
          <SettingRow title="拖拽上传目录" desc="拖到投屏窗口的文件在手机上的保存目录">
            <input
              type="text"
              className="dir-input"
              value={form.uploadDir}
              placeholder="/sdcard/Download"
              onChange={(e) => update('uploadDir', e.target.value)}
              aria-label="拖拽上传目录"
              style={{ width: 220 }}
            />
          </SettingRow>
          <SettingRow title="操控时智能黑屏" desc="电脑操控投屏时自动熄灭手机屏幕;触控手机屏幕或断开连接时自动恢复">
            <Switch
              label="智能黑屏"
              checked={form.autoBlackScreen}
              onChange={(v) => update('autoBlackScreen', v)}
            />
          </SettingRow>
          <SettingRow
            title="音频转发"
            desc="手机媒体声音在电脑播放(投屏窗口内播放,需 Android 11+)"
          >
            <Switch
              label="音频转发"
              checked={form.audio}
              onChange={(v) => update('audio', v)}
            />
          </SettingRow>
          <SettingRow title="视频编码" desc="H.265 更省带宽;个别手机不支持下拉到 H.264">
            <Segmented<'h264' | 'h265'>
              ariaLabel="视频编码"
              value={form.videoCodec}
              onChange={(v) => update('videoCodec', v)}
              options={[
                { value: 'h264', label: 'H.264' },
                { value: 'h265', label: 'H.265' },
              ]}
            />
          </SettingRow>
        </section>

        {/* 文件 */}
        <section className="card settings-group">
          <h2 className="settings-group-title">
            文件
            <span className="badge badge-accent badge-plain">M2</span>
          </h2>
          <SettingRow title="接收目录" desc="手机发来的文件默认保存位置,可输入路径修改">
            <div className="dir-control">
              <input
                className="dir-input mono"
                value={form.downloadDir}
                placeholder="未设置,默认使用系统下载目录"
                onChange={(e) => update('downloadDir', e.target.value)}
                aria-label="文件接收目录"
              />
              <button type="button" className="btn" disabled title="M2 里程碑开放">
                更改
              </button>
            </div>
          </SettingRow>
          <SettingRow
            title="并行传输数"
            desc="同时上传/下载的任务数(1-4)。真机已验证并发通道稳定;单一大文件不受影响"
          >
            <Segmented<number>
              ariaLabel="并行传输数"
              value={form.transferConcurrency}
              onChange={(v) => update('transferConcurrency', v)}
              options={[
                { value: 1, label: '1' },
                { value: 2, label: '2' },
                { value: 3, label: '3' },
                { value: 4, label: '4' },
              ]}
            />
          </SettingRow>
        </section>

        {/* 隐私 */}
        <section className="card settings-group">
          <h2 className="settings-group-title">
            隐私
            <span className="badge badge-accent badge-plain">M3</span>
          </h2>
          <SettingRow
            title="剪贴板同步模式"
            desc="自动模式会在两端复制时立即同步;手动模式仅在聚焦时同步。自动模式仅在投屏开启期间生效(经 scrcpy 控制通道同步)"
          >
            <Segmented<ClipboardMode>
              ariaLabel="剪贴板同步模式"
              value={form.clipboardMode}
              onChange={(v) => update('clipboardMode', v)}
              options={[
                { value: 'auto', label: '自动' },
                { value: 'manual', label: '手动' },
              ]}
            />
          </SettingRow>
          <SettingRow title="历史记录" desc="在本机保留最近同步的剪贴板历史,便于回贴">
            <Switch
              label="剪贴板历史记录"
              checked={form.keepHistory}
              onChange={(v) => update('keepHistory', v)}
            />
          </SettingRow>
        </section>

        {/* 伴侣 APK(M5) */}
        <CompanionGroup />
      </div>
    </section>
  )
}

/* ---------- 伴侣 APK 通道(M5)---------- */

interface PhoneStatus {
  id: string
  name: string
  connected: boolean
  pairedAt: number
  lastSeenAt?: number
}

/**
 * 伴侣设备组:配对(IP/端口/一次性配对码 → SAS 六位目视比对)、已配对手机管理、
 * 剪贴板互发与历史、「发送到手机」系统集成说明(M5-5)。
 */
function CompanionGroup() {
  const [phones, setPhones] = useState<PhoneStatus[]>([])
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('47888')
  const [otp, setOtp] = useState('')
  const [pairing, setPairing] = useState(false)
  const [sas, setSas] = useState<{ sas: string; phoneName: string } | null>(null)
  const [note, setNote] = useState('')

  const refresh = (): void => {
    void window.amoolink.companionStatus().then(setPhones).catch(() => undefined)
  }

  useEffect(() => {
    refresh()
    const offStatus = window.amoolink.onCompanionEvent('amoolink:companion:status', () => refresh())
    const offPaired = window.amoolink.onCompanionEvent('amoolink:companion:paired', () => {
      setSas(null)
      setNote('配对完成')
      refresh()
    })
    const offFailed = window.amoolink.onCompanionEvent('amoolink:companion:pair-failed', (p) => {
      const payload = p as { message?: string }
      setSas(null)
      setNote(`配对未完成:${payload.message ?? '手机端未确认'}`)
    })
    const offToast = window.amoolink.onCompanionEvent('amoolink:companion:toast', (p) => {
      const payload = p as { message?: string }
      if (payload.message) setNote(payload.message)
    })
    return () => {
      offStatus()
      offPaired()
      offFailed()
      offToast()
    }
  }, [])

  const startPair = (): void => {
    const p = Number.parseInt(port, 10)
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip.trim()) || !(p > 0 && p < 65536) || !/^[A-Z0-9]{8}$/i.test(otp.trim())) {
      setNote('请填写手机端显示的 IP、端口与 8 位配对码')
      return
    }
    setPairing(true)
    setNote('')
    window.amoolink
      .companionPair(ip.trim(), p, otp.trim().toUpperCase())
      .then((res) => {
        setSas(res)
        setNote('请与手机屏幕上的 6 位数字比对,一致后在手机上点「确认配对」')
      })
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : String(err)))
      .finally(() => setPairing(false))
  }

  const sendClipboard = (): void => {
    void navigator.clipboard
      .readText()
      .then((text) => window.amoolink.companionSendClipboard(text))
      .then(() => setNote('电脑剪贴板已发送到手机'))
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : String(err)))
  }

  const pullClipboard = (): void => {
    void window.amoolink
      .companionPullClipboard()
      .then((text) => {
        void navigator.clipboard.writeText(text)
        setNote(`已同步手机剪贴板:${text.slice(0, 30)}`)
      })
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : String(err)))
  }

  return (
    <section className="card settings-group">
      <h2 className="settings-group-title">
        伴侣设备(手机 App)
        <span className="badge badge-accent badge-plain">M5</span>
      </h2>

      <SettingRow
        title="配对新手机"
        desc="手机安装 AmooLink 伴侣 App 后,在手机上点「添加电脑」,把屏幕显示的地址与 8 位配对码填到这里"
      >
        <div className="companion-form">
          <input className="companion-input mono" placeholder="192.168.1.23" value={ip}
            onChange={(e) => setIp(e.target.value)} aria-label="手机 IP" />
          <input className="companion-input mono num" placeholder="47888" value={port}
            onChange={(e) => setPort(e.target.value)} aria-label="端口" />
          <input className="companion-input mono" placeholder="8 位配对码" value={otp} maxLength={8}
            onChange={(e) => setOtp(e.target.value.toUpperCase())} aria-label="配对码" />
          <button type="button" className="btn" disabled={pairing || sas !== null} onClick={startPair}>
            {pairing ? '连接中…' : '开始配对'}
          </button>
        </div>
      </SettingRow>

      {sas && (
        <div className="companion-sas" role="status">
          <p className="companion-sas-title">比对码(SAS)</p>
          <p className="companion-sas-code num">{sas.sas}</p>
          <p className="companion-sas-desc">与手机屏幕数字一致 → 在手机上点「确认配对」;不一致 → 取消并重试</p>
        </div>
      )}

      {note && <p className="companion-note">{note}</p>}

      {phones.length > 0 && (
        <SettingRow title="已配对手机" desc="证书钉扎连接;删除后需重新配对">
          <ul className="companion-phones">
            {phones.map((p) => (
              <li key={p.id} className="companion-phone">
                <span className={`companion-dot${p.connected ? ' on' : ''}`} />
                <span className="companion-phone-name">{p.name}</span>
                <span className="companion-phone-state">{p.connected ? '在线' : '离线'}</span>
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => void window.amoolink.companionForget(p.id)}>
                  忘记
                </button>
              </li>
            ))}
          </ul>
        </SettingRow>
      )}

      <SettingRow title="剪贴板互发" desc="电脑 ↔ 已配对手机(无需 USB/投屏;历史在本机加密保存)">
        <div className="companion-actions">
          <button type="button" className="btn btn-sm" onClick={sendClipboard}>发送剪贴板 → 手机</button>
          <button type="button" className="btn btn-sm" onClick={pullClipboard}>拉取手机剪贴板</button>
        </div>
      </SettingRow>

      <SettingRow
        title="发送到手机(系统集成)"
        desc="已注册 amoolink:// 协议:任何工具执行 open 'amoolink://send?text=…' 即可把文本发到手机剪贴板;macOS 可用 Automator 建一个「快速操作」运行该命令,即可加入右键菜单"
      >
        <span className="companion-hint mono num">open "amoolink://send?text=hello"</span>
      </SettingRow>
    </section>
  )
}
