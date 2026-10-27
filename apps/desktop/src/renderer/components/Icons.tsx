/**
 * 内联 SVG 图标集(T14)。
 * 统一 24×24 视窗、1.7 描边、currentColor 继承文字色;
 * 不引入图标库依赖,按需手绘。
 */

interface IconProps {
  size?: number
  className?: string
}

function Svg({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 应用 Logo:圆角方块 + 双向链路节点。 */
export function LogoIcon({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="var(--color-accent)" />
      <path
        d="M7.2 14.6 14.6 7.2"
        stroke="var(--color-on-accent)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeDasharray="2.6 2.2"
      />
      <circle cx="7.4" cy="7.4" r="2.1" fill="var(--color-on-accent)" />
      <circle cx="16.6" cy="16.6" r="2.1" fill="var(--color-on-accent)" />
    </svg>
  )
}

export function RefreshIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M20 12a8 8 0 1 1-2.35-5.65" />
      <path d="M20 3.6V8h-4.4" />
    </Svg>
  )
}

export function PhoneIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </Svg>
  )
}

export function MonitorIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M12 16.5V20" />
      <path d="M8.5 20.5h7" />
    </Svg>
  )
}

export function MonitorPlayIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M12 16.5V20" />
      <path d="M8.5 20.5h7" />
      <path d="m10.4 7.8 4 2.45-4 2.45z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function FolderIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3.5 7a2 2 0 0 1 2-2h4.1l2 2.5h6.9a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </Svg>
  )
}

export function TransferIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 21V4" />
      <path d="m4.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M16 3v17" />
      <path d="m12.5 16.5 3.5 3.5 3.5-3.5" />
    </Svg>
  )
}

export function SettingsIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.5 7H21.5" />
      <circle cx="15.5" cy="7" r="2.4" fill="var(--color-bg)" />
      <path d="M2.5 12.2h19" />
      <circle cx="8.5" cy="12.2" r="2.4" fill="var(--color-bg)" />
      <path d="M2.5 17.4h19" />
      <circle cx="17" cy="17.4" r="2.4" fill="var(--color-bg)" />
    </Svg>
  )
}

export function UsbIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 3.4v8.8" />
      <circle cx="12" cy="15.4" r="3.1" />
      <path d="M12 18.5V21" />
      <path d="M12 6.6 9.2 3.8" />
      <circle cx="8.3" cy="2.9" r="1.1" fill="currentColor" stroke="none" />
      <path d="M12 6.6l2.8-2.8" />
      <rect x="14.6" y="0.9" width="2.6" height="2.6" rx="0.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function WifiIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2.5 9.2a15 15 0 0 1 19 0" />
      <path d="M5.6 12.7a10.3 10.3 0 0 1 12.8 0" />
      <path d="M8.7 16.1a5.8 5.8 0 0 1 6.6 0" />
      <circle cx="12" cy="19.6" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function BoltIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M13 2.5 5.5 13.5h5l-1.5 8 8-11.5h-5z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** 铃铛:通知页导航与空状态(M3)。 */
export function BellIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 16v-5.5a6 6 0 0 1 12 0V16l1.8 2.5H4.2z" />
      <path d="M10 21a2.2 2.2 0 0 0 4 0" />
    </Svg>
  )
}

/** 相机:手机截图入口(M3)。 */
export function CameraIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-1.8h6.6L16.5 7h2A1.5 1.5 0 0 1 20 8.5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17z" />
      <circle cx="12" cy="12.6" r="3.2" />
    </Svg>
  )
}

export function CopyIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 15H4.8A1.8 1.8 0 0 1 3 13.2V4.8A1.8 1.8 0 0 1 4.8 3h8.4A1.8 1.8 0 0 1 15 4.8v.7" />
    </Svg>
  )
}

export function CheckIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  )
}

export function ChevronRightIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Svg>
  )
}

export function ChevronDownIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />
    </Svg>
  )
}

export function GridIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Svg>
  )
}

export function ListIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8.5 6h12" />
      <path d="M8.5 12h12" />
      <path d="M8.5 18h12" />
      <circle cx="4.4" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** 放大镜:应用面板搜索框。 */
export function SearchIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.6 15.6 4.4 4.4" />
    </Svg>
  )
}

export function UploadIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 15.5V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M4 16v2a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-2" />
    </Svg>
  )
}

export function ImageIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.8" cy="9.6" r="1.5" />
      <path d="m4 17 4.8-4.6 3.6 3.4 3.2-3.4 4.4 4.4" />
    </Svg>
  )
}

export function PackageIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="m12 2.8 8 4.4v9.6l-8 4.4-8-4.4V7.2z" />
      <path d="m4.3 7.3 7.7 4.2 7.7-4.2" />
      <path d="M12 11.5V21" />
    </Svg>
  )
}

/** 电池:level 0-100,charging 显示闪电。 */
export function BatteryIcon({
  level,
  charging = false,
  size = 26,
  className,
}: {
  level?: number
  charging?: boolean
  size?: number
  className?: string
}) {
  const clamped =
    level === undefined ? null : Math.max(0, Math.min(100, Math.round(level)))
  const fillWidth = clamped === null ? 0 : Math.max(1.6, (20 * clamped) / 100)
  return (
    <svg
      width={size}
      height={size * 0.56}
      viewBox="0 0 30 16"
      className={className}
      aria-hidden="true"
      role="img"
      aria-label={clamped === null ? '电量未知' : `电量 ${clamped}%${charging ? ',充电中' : ''}`}
    >
      <rect
        x="0.75"
        y="0.75"
        width="24"
        height="14.5"
        rx="3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.45"
      />
      <rect x="26.4" y="5.2" width="2.6" height="5.6" rx="1.3" fill="currentColor" opacity="0.45" />
      {clamped !== null && (
        <rect
          x="2.8"
          y="2.8"
          width={fillWidth}
          height="10.4"
          rx="1.8"
          fill="currentColor"
          className="battery-level"
          data-level={clamped <= 20 ? 'low' : 'normal'}
        />
      )}
      {charging && (
        <path
          d="M13.9 2.6 9.6 9h3.1l-1.1 4.4L16 7.1h-3.1z"
          className="battery-bolt"
          stroke="none"
        />
      )}
    </svg>
  )
}

/** 无设备空状态插画:手机 + USB 线 + 电脑(纯 SVG)。 */
export function ConnectArtwork({ className }: { className?: string }) {
  return (
    <svg
      width="220"
      height="120"
      viewBox="0 0 220 120"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 笔记本电脑 */}
      <rect x="14" y="28" width="76" height="48" rx="5" />
      <path d="M6 84h92" opacity="0.6" />
      <path d="M40 84h24l-4-6H44z" opacity="0.6" />
      {/* 手机 */}
      <rect x="164" y="18" width="40" height="76" rx="9" />
      <path d="M179 86h10" opacity="0.6" />
      {/* 屏幕内容点饰 */}
      <path d="M172 32h24" opacity="0.35" />
      <path d="M172 40h16" opacity="0.35" />
      {/* USB 线(虚线)与接头 */}
      <path d="M90 56c18 0 22-24 40-24" strokeDasharray="4 5" opacity="0.7" />
      <rect x="128" y="24" width="12" height="8" rx="2" opacity="0.85" />
      <path d="M132 24v-6h4v6" opacity="0.85" />
      <path d="M140 28h24" opacity="0" />
      {/* 信号点 */}
      <circle cx="52" cy="52" r="2" fill="currentColor" stroke="none" opacity="0.5" />
    </svg>
  )
}

export function NoteIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M6 3.5h9.5L19 7v13.5H6z" />
      <path d="M15 3.5V7.4h4" />
      <path d="M9 11h6.5" />
      <path d="M9 14.5h6.5" />
      <path d="M9 18h4" />
    </Svg>
  )
}

export function PinIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 15.5v5" />
      <path d="M8.2 4h7.6l-1.2 5.2 2.4 2.6v1.7H7v-1.7l2.4-2.6z" />
    </Svg>
  )
}

export function SyncIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4.5 9.5a8 8 0 0 1 13.6-2.4" />
      <path d="M19.5 14.5a8 8 0 0 1-13.6 2.4" />
      <path d="M18.6 3.4v3.9h-3.9" />
      <path d="M5.4 20.6v-3.9h3.9" />
    </Svg>
  )
}

export function PlusIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  )
}

export function TrashIcon({ size, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4.5 6.5h15" />
      <path d="M9 6.5V4.8c0-.7.6-1.3 1.3-1.3h3.4c.7 0 1.3.6 1.3 1.3v1.7" />
      <path d="M6.5 6.5l.8 12.2c.1.9.8 1.6 1.7 1.6h6c.9 0 1.6-.7 1.7-1.6l.8-12.2" />
      <path d="M10 10.5v5.5" />
      <path d="M14 10.5v5.5" />
    </Svg>
  )
}
