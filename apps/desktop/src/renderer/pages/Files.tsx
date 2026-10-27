import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, MouseEvent } from 'react'
import { useCurrentDevice } from '../bridge'
import {
  CheckIcon,
  ChevronRightIcon,
  FolderIcon,
  PhoneIcon,
  RefreshIcon,
  UploadIcon,
} from '../components/Icons'
import './Files.css'

/** 目录条目(与 preload listDeviceDir 返回结构一致)。 */
interface DirEntry {
  name: string
  isDir: boolean
  size: number
  mtimeMs: number
}

/** 快捷目录 chips。 */
const QUICK_DIRS = [
  { label: '内部存储', path: '/sdcard' },
  { label: '下载', path: '/sdcard/Download' },
  { label: '相册', path: '/sdcard/DCIM' },
  { label: '图片', path: '/sdcard/Pictures' },
  { label: '视频', path: '/sdcard/Movies' },
  { label: '音乐', path: '/sdcard/Music' },
] as const

/** 接收目录缺省值(与任务说明约定的回退路径)。 */
const DEFAULT_DOWNLOAD_DIR = '~/Downloads/AmooLink'
/** 删除二次确认的有效期:超时自动解除武装。 */
const ARM_CONFIRM_MS = 3000

/* ---------- 工具 ---------- */

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

/** mtimeMs → YYYY-MM-DD HH:mm(本地时区)。 */
function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function joinRemotePath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 面包屑段:路径拆分为可点击的祖先链;/sdcard 根显示为「内部存储」。 */
function crumbSegments(path: string): Array<{ label: string; path: string }> {
  const segs = path.split('/').filter(Boolean)
  const out: Array<{ label: string; path: string }> = []
  let acc = ''
  segs.forEach((seg, i) => {
    acc += `/${seg}`
    out.push({ label: i === 0 && seg === 'sdcard' ? '内部存储' : seg, path: acc })
  })
  return out
}

/** 页内轻提示:支持一个可选动作按钮(如「打开目录」)。 */
interface ToastState {
  message: string
  action?: { label: string; run: () => void }
}

/**
 * 文件管理页(M2):浏览设备目录、上传(选择/拖拽)、下载、删除。
 * 设备取第一台 state==='device';无设备时整页空状态。
 */
export default function FilesPage() {
  const { serial, loading: devicesLoading, error: devicesError } = useCurrentDevice()

  const [dir, setDir] = useState('/sdcard')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [dragging, setDragging] = useState(false)
  /** 拖入时高亮的目标目录行(目录感知 drop)。 */
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null)
  const [armedDelete, setArmedDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toastState, setToastState] = useState<ToastState | null>(null)
  /** 用户正从文件行向外拖(拖出窗口 = 下载到接收目录)。 */
  const dragOutRef = useRef(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const toastTimerRef = useRef<number | null>(null)
  const armTimerRef = useRef<number | null>(null)

  /* ---------- 目录加载(设备/路径/手动刷新触发) ---------- */
  useEffect(() => {
    if (!serial) return
    let disposed = false
    setListLoading(true)
    setListError(null)
    window.amoolink
      .listDeviceDir(serial, dir)
      .then((res) => {
        if (!disposed) setEntries(res.entries ?? [])
      })
      .catch((err: unknown) => {
        if (!disposed) setListError(errorMessage(err))
      })
      .finally(() => {
        if (!disposed) setListLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [serial, dir, reloadNonce])

  /* ---------- toast 定时消失 ---------- */
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
    }
  }, [])

  function showToast(message: string, action?: ToastState['action']): void {
    setToastState({ message, action })
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastState(null), action ? 5000 : 2600)
  }

  function clearArm(): void {
    setArmedDelete(false)
    if (armTimerRef.current !== null) {
      window.clearTimeout(armTimerRef.current)
      armTimerRef.current = null
    }
  }

  // 选择集变化时解除删除确认的武装态
  useEffect(clearArm, [selected])

  /* ---------- 排序:目录在前,名称 locale 排序 ---------- */
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    })
  }, [entries])

  const crumbs = useMemo(() => crumbSegments(dir), [dir])
  const selectedFiles = useMemo(
    () => sortedEntries.filter((e) => !e.isDir && selected.has(e.name)),
    [sortedEntries, selected],
  )
  const allChecked = sortedEntries.length > 0 && selected.size === sortedEntries.length

  /* ---------- 导航 ---------- */
  function navigate(path: string): void {
    setSelected(new Set())
    setDir(path)
  }

  /* ---------- 选择 ---------- */
  function toggleEntry(name: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function onRowClick(e: MouseEvent<HTMLDivElement>, entry: DirEntry): void {
    if (e.metaKey || e.ctrlKey) toggleEntry(entry.name)
    else if (selected.size === 1 && selected.has(entry.name)) setSelected(new Set())
    else setSelected(new Set([entry.name]))
  }

  function toggleSelectAll(): void {
    setSelected(allChecked ? new Set() : new Set(sortedEntries.map((e) => e.name)))
  }

  /* ---------- 上传(选择器 / 拖拽共用;targetDir 支持目录感知 drop) ---------- */
  function startUpload(localPaths: string[], targetDir?: string): void {
    if (!serial || localPaths.length === 0) return
    const hasApk = localPaths.some((p) => p.toLowerCase().endsWith('.apk'))
    setBusy(true)
    window.amoolink
      .uploadFiles(serial, localPaths, targetDir ?? dir)
      .then((tasks) => {
        const suffix = hasApk ? ' · APK 将在上传后自动安装' : ''
        const where = targetDir ?? dir
        showToast(`已添加 ${tasks.length} 个上传任务 → ${where}${suffix}`)
      })
      .catch((err: unknown) => showToast(`上传失败:${errorMessage(err)}`))
      .finally(() => setBusy(false))
  }

  function pathsFromFileList(files: FileList | null): string[] {
    if (!files) return []
    const paths: string[] = []
    for (const file of Array.from(files)) {
      const p = window.amoolinkFiles.getPathForFile(file)
      if (p !== '') paths.push(p)
    }
    return paths
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>): void {
    const input = e.target
    const paths = pathsFromFileList(input.files)
    input.value = '' // 允许重复选择同一文件
    if (paths.length === 0) {
      if (input.files && input.files.length > 0) showToast('无法获取所选文件的本地路径')
      return
    }
    startUpload(paths)
  }

  /* ---------- 拖拽上传 / 拖出下载 ---------- */
  function onDragOver(e: DragEvent<HTMLElement>): void {
    e.preventDefault()
    // 只有拖入本地文件才显示上传遮罩(拖出手机文件时 types 不含 Files)
    if (!dragging && e.dataTransfer.types.includes('Files')) setDragging(true)
  }

  function onDragLeave(e: DragEvent<HTMLElement>): void {
    const to = e.relatedTarget
    if (to instanceof Node && e.currentTarget.contains(to)) return
    setDragging(false)
    setDropTargetDir(null)
    // 文件从列表拖出窗口外 → 触发下载到接收目录
    if (to === null && dragOutRef.current) {
      dragOutRef.current = false
      handleDownload(true)
    }
  }

  function onDrop(e: DragEvent<HTMLElement>): void {
    e.preventDefault()
    setDragging(false)
    setDropTargetDir(null)
    if (!serial) return
    const paths = pathsFromFileList(e.dataTransfer.files)
    if (paths.length === 0) {
      showToast('未识别到可上传的文件')
      return
    }
    startUpload(paths)
  }

  /** 目录行的拖入(目录感知):上传进该目录。 */
  function onDirRowDragOver(e: DragEvent<HTMLElement>, dirPath: string): void {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropTargetDir(dirPath)
  }

  function onDirRowDragLeave(e: DragEvent<HTMLElement>): void {
    const to = e.relatedTarget
    if (to instanceof Node && e.currentTarget.contains(to)) return
    setDropTargetDir(null)
  }

  function onDirRowDrop(e: DragEvent<HTMLElement>, dirPath: string): void {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    setDropTargetDir(null)
    if (!serial) return
    const paths = pathsFromFileList(e.dataTransfer.files)
    if (paths.length === 0) return
    startUpload(paths, dirPath)
  }

  /* ---------- 下载选中(dragOut=true 表示由拖出窗口触发,自动打开接收目录) ---------- */
  function handleDownload(dragOut = false): void {
    if (!serial || selectedFiles.length === 0 || busy) return
    const files = selectedFiles.map((e) => ({
      remotePath: joinRemotePath(dir, e.name),
      name: e.name,
      size: e.size,
    }))
    setBusy(true)
    window.amoolink
      .downloadFiles(serial, files)
      .then(async () => {
        let downloadDir = ''
        try {
          const settings = await window.amoolink.getSettings()
          downloadDir = settings.files.downloadDir
        } catch {
          /* 设置读取失败时用回退目录 */
        }
        const target = downloadDir !== '' ? downloadDir : DEFAULT_DOWNLOAD_DIR
        if (dragOut) {
          showToast(`已把 ${files.length} 个文件下载到 ${target}`, { label: '打开目录', run: () => {
            void window.amoolink.openDirectory(target)
          } })
          void window.amoolink.openDirectory(target)
        } else {
          showToast(`已加入下载队列(${files.length} 个文件),完成后保存到接收目录`, {
            label: '打开目录',
            run: () => {
              void window.amoolink.openDirectory(target).catch((err: unknown) =>
                showToast(`打开目录失败:${errorMessage(err)}`),
              )
            },
          })
        }
      })
      .catch((err: unknown) => showToast(`下载失败:${errorMessage(err)}`))
      .finally(() => setBusy(false))
  }

  /* ---------- 删除选中(双击确认语义:再次点击才执行) ---------- */
  function handleDelete(): void {
    if (!serial || selected.size === 0 || busy) return
    if (!armedDelete) {
      setArmedDelete(true)
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
      armTimerRef.current = window.setTimeout(clearArm, ARM_CONFIRM_MS)
      return
    }
    clearArm()
    const paths = Array.from(selected, (name) => joinRemotePath(dir, name))
    setBusy(true)
    Promise.all(paths.map((p) => window.amoolink.deleteDevicePath(serial, p)))
      .then(() => {
        setSelected(new Set())
        showToast(`已删除 ${paths.length} 项`)
        setReloadNonce((n) => n + 1)
      })
      .catch((err: unknown) => showToast(`删除失败:${errorMessage(err)}`))
      .finally(() => setBusy(false))
  }

  /* ---------- 渲染 ---------- */

  const noDevice = !serial && !devicesLoading && !devicesError

  return (
    <section
      className={`page files-page${dragging ? ' dragging' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="page-header">
        <h1 className="page-title">文件</h1>
        <div className="spacer" />
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!serial || busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon size={14} />
            上传文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={onPickFiles}
            aria-label="选择要上传的文件"
          />
          <button
            type="button"
            className="btn icon-btn"
            disabled={!serial || listLoading}
            onClick={() => setReloadNonce((n) => n + 1)}
            title="刷新当前目录"
            aria-label="刷新当前目录"
          >
            <RefreshIcon size={15} className={listLoading ? 'spin' : undefined} />
          </button>
        </div>
      </header>

      <div className="page-body files-body">
        {devicesError && (
          <div className="banner-error" role="alert">
            <span className="num">设备服务异常:{devicesError}</span>
          </div>
        )}

        {noDevice ? (
          <div className="card files-full-empty">
            <div className="empty-state">
              <span className="empty-icon">
                <PhoneIcon size={24} />
              </span>
              <p className="empty-title">未检测到已连接的设备</p>
              <p className="empty-desc">
                用 USB 线连接手机并允许调试授权后,即可在这里浏览与管理手机文件。
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* 快捷目录 + 路径面包屑 */}
            <nav className="files-toolbar" aria-label="目录导航">
              <div className="quick-chips" role="group" aria-label="快捷目录">
                {QUICK_DIRS.map((q) => (
                  <button
                    key={q.path}
                    type="button"
                    className={`chip${dir === q.path ? ' active' : ''}`}
                    disabled={!serial}
                    onClick={() => navigate(q.path)}
                    aria-pressed={dir === q.path}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <div className="crumbs card" aria-label="当前路径">
                {crumbs.map((c, i) => {
                  const isLast = i === crumbs.length - 1
                  return (
                    <span key={c.path} className="crumb-wrap">
                      {isLast ? (
                        <span className="crumb current">
                          {i === 0 && <FolderIcon size={14} />}
                          {c.label}
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="crumb crumb-link"
                            onClick={() => navigate(c.path)}
                          >
                            {i === 0 && <FolderIcon size={14} />}
                            {c.label}
                          </button>
                          <ChevronRightIcon size={13} className="crumb-sep" />
                        </>
                      )}
                    </span>
                  )
                })}
              </div>
            </nav>

            {/* 目录列表 */}
            <div className="card files-list" role="listbox" aria-multiselectable="true" aria-label="文件列表">
              <div className="fl-head" role="presentation">
                <button
                  type="button"
                  className={`fl-check${allChecked ? ' on' : ''}${!allChecked && selected.size > 0 ? ' partial' : ''}`}
                  onClick={toggleSelectAll}
                  role="checkbox"
                  aria-checked={allChecked}
                  aria-label="全选"
                  disabled={!serial || sortedEntries.length === 0}
                >
                  {allChecked && <CheckIcon size={11} />}
                </button>
                <span className="fl-col-name">名称</span>
                <span className="fl-col-size">大小</span>
                <span className="fl-col-mtime">修改时间</span>
              </div>

              {listLoading && sortedEntries.length === 0 ? (
                <div className="fl-skeleton" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="fl-row skeleton-row">
                      <div className="skeleton fl-sk-icon" />
                      <div className="skeleton fl-sk-name" />
                      <div className="skeleton fl-sk-size" />
                      <div className="skeleton fl-sk-time" />
                    </div>
                  ))}
                </div>
              ) : listError ? (
                <div className="empty-state">
                  <span className="empty-icon fl-error-icon">!</span>
                  <p className="empty-title">目录读取失败</p>
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
              ) : sortedEntries.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">
                    <FolderIcon size={24} />
                  </span>
                  <p className="empty-title">此目录为空</p>
                  <p className="empty-desc">把文件拖进窗口即可上传到当前目录。</p>
                </div>
              ) : (
                <div className="fl-rows">
                  {sortedEntries.map((entry) => {
                    const isSelected = selected.has(entry.name)
                    const dirPath = joinRemotePath(dir, entry.name)
                    const isDropTarget = entry.isDir && dropTargetDir === dirPath
                    return (
                      <div
                        key={entry.name}
                        className={`fl-row${isSelected ? ' selected' : ''}${isDropTarget ? ' drop-target' : ''}`}
                        role="option"
                        aria-selected={isSelected}
                        draggable={!entry.isDir && isSelected}
                        onDragStart={(e) => {
                          dragOutRef.current = true
                          e.dataTransfer.effectAllowed = 'copy'
                          e.dataTransfer.setData('text/plain', entry.name)
                        }}
                        onDragEnd={() => {
                          dragOutRef.current = false
                        }}
                        onDragOver={entry.isDir ? (e) => onDirRowDragOver(e, dirPath) : undefined}
                        onDragLeave={entry.isDir ? onDirRowDragLeave : undefined}
                        onDrop={entry.isDir ? (e) => onDirRowDrop(e, dirPath) : undefined}
                        onClick={(e) => onRowClick(e, entry)}
                        onDoubleClick={() => {
                          if (entry.isDir) navigate(dirPath)
                        }}
                      >
                        <button
                          type="button"
                          className={`fl-check${isSelected ? ' on' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleEntry(entry.name)
                          }}
                          role="checkbox"
                          aria-checked={isSelected}
                          aria-label={`选择 ${entry.name}`}
                          tabIndex={-1}
                        >
                          {isSelected && <CheckIcon size={11} />}
                        </button>
                        <span className={`fl-icon${entry.isDir ? ' dir' : ' file'}`} aria-hidden="true">
                          {entry.isDir ? <FolderIcon size={16} /> : null}
                        </span>
                        <span className="fl-name" title={entry.name}>
                          {entry.name}
                        </span>
                        <span className="fl-size num">{entry.isDir ? '—' : formatBytes(entry.size)}</span>
                        <span className="fl-mtime num">{formatDateTime(entry.mtimeMs)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 选中操作条 */}
            {selected.size > 0 && (
              <div className="files-actionbar" role="toolbar" aria-label="选中项操作">
                <span className="num actionbar-count">已选 {selected.size} 项</span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={selectedFiles.length === 0 || busy}
                  onClick={() => handleDownload()}
                  title={selectedFiles.length === 0 ? '仅文件可下载' : `下载 ${selectedFiles.length} 个文件`}
                >
                  下载选中
                </button>
                <button
                  type="button"
                  className={`btn btn-sm${armedDelete ? ' btn-danger-armed' : ''}`}
                  disabled={busy}
                  onClick={handleDelete}
                >
                  {armedDelete ? '再次点击确认删除' : '删除'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelected(new Set())}
                >
                  取消选择
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 拖拽遮罩 */}
      {dragging && serial && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-hint card">
            <UploadIcon size={22} />
            <p className="drop-title">松开以上传</p>
            <p className="drop-desc mono">{dir}</p>
          </div>
        </div>
      )}

      {/* 轻提示(支持动作按钮) */}
      {toastState && (
        <div className="toast files-toast" role="status">
          <span>{toastState.message}</span>
          {toastState.action && (
            <button
              type="button"
              className="files-toast-action"
              onClick={() => {
                toastState.action?.run()
                setToastState(null)
              }}
            >
              {toastState.action.label}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
