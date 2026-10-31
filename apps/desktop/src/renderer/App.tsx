import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import './styles/tokens.css'
import './styles/global.css'
import './App.css'
import {
  BellIcon,
  FolderIcon,
  GridIcon,
  LogoIcon,
  MonitorIcon,
  NoteIcon,
  PhoneIcon,
  SettingsIcon,
  TransferIcon,
} from './components/Icons'
import AppsPage from './pages/Apps'
import DataPage from './pages/Data'
import DevicesPage from './pages/Devices'
import FilesPage from './pages/Files'
import MirrorPage from './pages/Mirror'
import MirrorWindowPage from './pages/MirrorWindow'
import NotesPage from './pages/Notes'
import NotificationsPage from './pages/Notifications'
import SettingsPage from './pages/Settings'
import TransfersPage from './pages/Transfers'

const NAV_ITEMS = [
  { to: '/', label: '设备', icon: PhoneIcon, end: true, badge: null },
  { to: '/mirror', label: '投屏', icon: MonitorIcon, end: false, badge: 'M1' },
  { to: '/notes', label: '笔记', icon: NoteIcon, end: false, badge: 'M6' },
  { to: '/apps', label: '应用', icon: GridIcon, end: false, badge: null },
  { to: '/files', label: '文件', icon: FolderIcon, end: false, badge: 'M2' },
  { to: '/transfers', label: '传输', icon: TransferIcon, end: false, badge: 'M2' },
  { to: '/notifications', label: '通知', icon: BellIcon, end: false, badge: 'M3' },
  { to: '/data', label: '数据', icon: FolderIcon, end: false, badge: 'M5' },
  { to: '/settings', label: '设置', icon: SettingsIcon, end: false, badge: null },
] as const

/**
 * 应用外壳(T17):侧边导航 + 内容区。
 * macOS hiddenInset 标题栏:侧边栏整体可拖拽,交互元素 no-drag(见 global.css)。
 */
export default function App() {
  const [version, setVersion] = useState<string>('')
  const location = useLocation()

  // 投屏窗口:独立全屏路由,不带主窗口侧栏
  if (location.pathname.startsWith('/mirror-window')) {
    return (
      <Routes>
        <Route path="/mirror-window/:serial" element={<MirrorWindowPage />} />
      </Routes>
    )
  }

  useEffect(() => {
    let disposed = false
    void window.amoolink
      .getAppInfo()
      .then((info) => {
        if (!disposed) setVersion(info.version)
      })
      .catch(() => {
        /* 版本号获取失败时静默,侧栏不展示 */
      })
    return () => {
      disposed = true
    }
  }, [])

  return (
    <div className="app">
      <aside className="sidebar drag">
        <div className="sidebar-brand">
          <LogoIcon size={24} />
          <span className="sidebar-brand-name">AmooLink</span>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-item${isActive ? ' active' : ''}`
              }
            >
              <item.icon size={17} className="nav-item-icon" />
              <span className="nav-item-label">{item.label}</span>
              {item.badge && <span className="nav-item-badge">{item.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {version && (
            <span className="num sidebar-version" title="应用版本">
              v{version}
            </span>
          )}
          <span className="sidebar-copyright">跨设备 · 更默契</span>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<DevicesPage />} />
          <Route path="/mirror" element={<MirrorPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
