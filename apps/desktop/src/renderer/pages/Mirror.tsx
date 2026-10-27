import { Link } from 'react-router-dom'
import { MonitorPlayIcon } from '../components/Icons'
import './Mirror.css'

/**
 * 投屏引导页:投屏窗口由设备页「开始投屏」逐台打开,本页仅提供入口说明。
 */
export default function MirrorPage() {
  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">投屏</h1>
        <span className="badge badge-accent badge-plain milestone-badge">M1</span>
        <div className="spacer" />
      </header>

      <div className="page-body mirror-body">
        <div className="card mirror-hero">
          <span className="mirror-icon">
            <MonitorPlayIcon size={34} />
          </span>
          <h2 className="mirror-title">投屏已开放</h2>
          <p className="mirror-desc">
            在设备页点击「开始投屏」即可为单台设备打开投屏窗口;支持多设备同投。
          </p>
          <div className="mirror-actions">
            <Link to="/" className="btn btn-primary">
              前往设备页
            </Link>
            <Link to="/settings" className="btn">
              查看投屏设置
            </Link>
          </div>
          <ul className="mirror-features">
            <li>实时画面 · 最低 40ms 延迟目标</li>
            <li>键鼠反控 · 支持中文输入</li>
            <li>H.264 硬件编码 · H.265 M2 支持</li>
          </ul>
        </div>
      </div>
    </section>
  )
}
