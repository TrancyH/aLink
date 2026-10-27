import { useMemo } from 'react'
import { useTransfers } from '../bridge'
import type { TransferTask } from '../bridge'
import { PackageIcon, TransferIcon, UploadIcon } from '../components/Icons'
import './Transfers.css'

/** 任务状态 → 徽标文案与色调。 */
const STATUS_META: Record<TransferTask['state'], { label: string; tone: string }> = {
  queued: { label: '排队中', tone: 'badge-neutral' },
  running: { label: '传输中', tone: 'badge-accent' },
  done: { label: '已完成', tone: 'badge-success' },
  failed: { label: '失败', tone: 'badge-danger' },
  canceled: { label: '已取消', tone: 'badge-neutral' },
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** localPath 是文件全路径:截取最后一个分隔符之前作为所在目录。 */
function dirOf(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return idx > 0 ? filePath.slice(0, idx) : filePath
}

/** 进度百分比:size 未知时按状态推断。 */
function percentOf(task: TransferTask): number {
  if (task.size > 0) return Math.min(100, Math.round((task.transferred / task.size) * 100))
  return task.state === 'done' ? 100 : 0
}

/**
 * 传输队列页(M2):listTransfers 初始化 + onTransfersUpdated 订阅实时更新。
 */
export default function TransfersPage() {
  const { transfers, refresh } = useTransfers()

  const runningCount = useMemo(
    () => transfers.filter((t) => t.state === 'running').length,
    [transfers],
  )
  const hasClearable = useMemo(
    () => transfers.some((t) => t.state === 'done' || t.state === 'canceled'),
    [transfers],
  )

  function act(p: Promise<{ ok: boolean }>): void {
    // 操作结果以订阅推送为准;异常静默,队列状态由下一次广播纠正
    p.catch(() => {
      /* noop */
    })
  }

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">
          传输
          <span className="count num">共 {transfers.length} 项 · 传输中 {runningCount}</span>
        </h1>
        <div className="spacer" />
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={!hasClearable}
            onClick={() => {
              act(window.amoolink.clearFinishedTransfers())
              refresh()
            }}
            title="移除已完成与已取消的任务记录"
          >
            清除已完成
          </button>
        </div>
      </header>

      <div className="page-body transfers-body">
        <div className="card transfer-table" role="table" aria-label="传输队列">
          <div className="t-row t-head" role="row">
            <span className="t-cell t-dir" role="columnheader">
              方向
            </span>
            <span className="t-cell" role="columnheader">
              文件名
            </span>
            <span className="t-cell t-size" role="columnheader">
              大小
            </span>
            <span className="t-cell t-progress" role="columnheader">
              进度
            </span>
            <span className="t-cell t-status" role="columnheader">
              状态
            </span>
            <span className="t-cell t-actions" role="columnheader">
              操作
            </span>
          </div>

          {transfers.length === 0 ? (
            <div className="t-body" role="rowgroup">
              <div className="empty-state t-empty">
                <span className="empty-icon">
                  <TransferIcon size={24} />
                </span>
                <p className="empty-title">暂无传输任务</p>
                <p className="empty-desc">在文件页上传或下载,队列会显示在这里。</p>
              </div>
            </div>
          ) : (
            <div className="t-body t-list" role="rowgroup">
              {transfers.map((task) => {
                const pct = percentOf(task)
                const status = STATUS_META[task.state]
                const meterTone =
                  task.state === 'done'
                    ? ' success'
                    : task.state === 'failed' || task.state === 'canceled'
                      ? ' danger'
                      : ''
                return (
                  <div
                    key={task.id}
                    className={`t-row t-task state-${task.state}`}
                    role="row"
                    title={task.error ?? undefined}
                  >
                    <span
                      className={`t-dir-icon ${task.direction === 'download' ? 'down' : 'up'}`}
                      role="cell"
                      aria-label={task.direction === 'download' ? '下载' : '上传'}
                    >
                      <UploadIcon size={15} />
                    </span>

                    <span className="t-file" role="cell">
                      <span className="t-name" title={task.fileName}>
                        {task.fileName}
                      </span>
                      {task.isInstall && (
                        <span className="t-install badge badge-accent badge-plain">
                          <PackageIcon size={11} />
                          APK · 完成后自动安装
                        </span>
                      )}
                      {task.state === 'failed' && task.error && (
                        <span className="t-error" title={task.error}>
                          {task.error}
                        </span>
                      )}
                    </span>

                    <span className="t-cell t-size num" role="cell">
                      {formatBytes(task.size)}
                    </span>

                    <span className="t-progress-cell" role="cell">
                      <span className="meter t-meter">
                        <span
                          className={`meter-fill${meterTone}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="t-pct num">{task.size > 0 || task.state === 'done' ? `${pct}%` : '—'}</span>
                    </span>

                    <span className="t-cell t-status-cell" role="cell">
                      <span className={`badge ${status.tone}`}>{status.label}</span>
                    </span>

                    <span className="t-actions-cell" role="cell">
                      {(task.state === 'queued' || task.state === 'running') && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => act(window.amoolink.cancelTransfer(task.id))}
                        >
                          取消
                        </button>
                      )}
                      {(task.state === 'failed' || task.state === 'canceled') && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => act(window.amoolink.retryTransfer(task.id))}
                        >
                          重试
                        </button>
                      )}
                      {task.state === 'done' && task.direction === 'download' && task.localPath && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            act(window.amoolink.openDirectory(dirOf(task.localPath)))
                          }
                          title={dirOf(task.localPath)}
                        >
                          打开目录
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
