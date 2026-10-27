import { useEffect, useMemo, useState } from 'react'
import type { DeviceInfo } from '@amoolink/adb'

/**
 * 设备列表状态钩子:初始拉取 + 订阅主进程广播。
 * UI 层(T14-T17)消费此钩子,不直接触碰 window.amoolink。
 */
export function useDevices(): {
  devices: DeviceInfo[]
  loading: boolean
  error: string | null
  refresh: () => void
} {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    void window.amoolink
      .getDevices()
      .then((list) => {
        if (!disposed) {
          setDevices(list)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!disposed) {
          setError(String(err))
          setLoading(false)
        }
      })
    const unsubscribe = window.amoolink.onDevicesChanged((list) => {
      if (!disposed) {
        setDevices(list)
        setError(null)
        setLoading(false)
      }
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const refresh = (): void => {
    void window.amoolink
      .refreshDevices()
      .then((list) => setDevices(list))
      .catch((err: unknown) => setError(String(err)))
  }

  return { devices, loading, error, refresh }
}

/* ============================================================
   M2 扩展钩子:传输队列 / 当前可用设备
   ============================================================ */

/** 传输任务(与 main/services/transfer-service.ts 的 TransferTask 对齐)。 */
export interface TransferTask {
  id: string
  serial: string
  direction: 'upload' | 'download'
  fileName: string
  localPath: string
  remotePath: string
  size: number
  transferred: number
  state: 'queued' | 'running' | 'done' | 'failed' | 'canceled'
  error?: string
  isInstall?: boolean
}

/** unknown[] → TransferTask[]:仅保留关键字段齐全的条目,坏数据直接丢弃。 */
function asTransferTasks(list: unknown[]): TransferTask[] {
  return list.filter(
    (t): t is TransferTask =>
      typeof t === 'object' &&
      t !== null &&
      'id' in t &&
      'state' in t &&
      'fileName' in t &&
      'direction' in t,
  )
}

/** 传输队列状态钩子:初始 listTransfers + 订阅 onTransfersUpdated(200ms 节流推送)。 */
export function useTransfers(): {
  transfers: TransferTask[]
  refresh: () => void
} {
  const [transfers, setTransfers] = useState<TransferTask[]>([])

  useEffect(() => {
    let disposed = false
    void window.amoolink
      .listTransfers()
      .then((list) => {
        if (!disposed) setTransfers(asTransferTasks(list))
      })
      .catch(() => {
        /* 初始拉取失败时等待订阅推送 */
      })
    const unsubscribe = window.amoolink.onTransfersUpdated((list) => {
      if (!disposed) setTransfers(asTransferTasks(list))
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const refresh = (): void => {
    void window.amoolink
      .listTransfers()
      .then((list) => setTransfers(asTransferTasks(list)))
      .catch(() => {
        /* 刷新失败保持现状,后续订阅会纠正 */
      })
  }

  return { transfers, refresh }
}

/** 当前可用设备:第一台 state==='device' 的序列号;无设备时 serial 为 null。 */
export function useCurrentDevice(): {
  serial: string | null
  device: DeviceInfo | null
  loading: boolean
  error: string | null
} {
  const { devices, loading, error } = useDevices()
  const device = useMemo(
    () => devices.find((d) => d.state === 'device') ?? null,
    [devices],
  )
  return { serial: device?.serial ?? null, device, loading, error }
}

/* ============================================================
   M3 扩展钩子:手机通知
   ============================================================ */

/** 通知条目(与 preload 声明对齐);fresh 标记实时新到条目,供高亮渐入动画消费。 */
export interface NotificationItem {
  key: string
  pkg: string
  title: string
  text: string
  whenMs: number
  importance: string
  fresh?: boolean
}

/** unknown → NotificationItem:关键字段缺失或类型不符时丢弃,坏数据不进列表。 */
function asNotification(raw: unknown): NotificationItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.key !== 'string' || typeof o.pkg !== 'string') return null
  return {
    key: o.key,
    pkg: o.pkg,
    title: typeof o.title === 'string' ? o.title : '',
    text: typeof o.text === 'string' ? o.text : '',
    whenMs: typeof o.whenMs === 'number' ? o.whenMs : Date.now(),
    importance: typeof o.importance === 'string' ? o.importance : '',
  }
}

/** 通知列表状态钩子:初始 listNotifications(按时间倒序)+ onNotificationNew 实时置顶插入。 */
export function useNotifications(): {
  notifications: NotificationItem[]
  clear: () => void
} {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])

  useEffect(() => {
    let disposed = false
    void window.amoolink
      .listNotifications()
      .then((list) => {
        if (disposed) return
        setNotifications(
          list
            .map(asNotification)
            .filter((n): n is NotificationItem => n !== null)
            .sort((a, b) => b.whenMs - a.whenMs),
        )
      })
      .catch(() => {
        /* 初始拉取失败时保持空列表,等待订阅推送 */
      })
    const unsubscribe = window.amoolink.onNotificationNew((raw) => {
      const item = asNotification(raw)
      if (disposed || !item) return
      // 同 key 的更新条目去重后置顶,并打 fresh 标记触发高亮
      setNotifications((prev) => [
        { ...item, fresh: true },
        ...prev.filter((p) => p.key !== item.key),
      ])
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  /** 仅清空本地列表状态,不影响主进程轮询与后续订阅推送。 */
  const clear = (): void => setNotifications([])

  return { notifications, clear }
}

/** 笔记同步状态(镜像 @amoolink/notes-editor SyncState,避免渲染端拉入主进程模块)。 */
export type NotesSyncState =
  | { phase: 'idle'; lastSyncAt: number | null }
  | { phase: 'scanning' }
  | { phase: 'syncing'; up: number; down: number }
  | { phase: 'done'; up: number; down: number; at: number }
  | { phase: 'error'; message: string }

export interface NoteListItemView {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  pinned: boolean
  excerpt: string
  wordCount: number
}

function asNoteListItem(raw: unknown): NoteListItemView | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.updatedAt !== 'string') return null
  return {
    id: o.id,
    title: typeof o.title === 'string' ? o.title : '未命名笔记',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date(0).toISOString(),
    updatedAt: o.updatedAt,
    pinned: o.pinned === true,
    excerpt: typeof o.excerpt === 'string' ? o.excerpt : '',
    wordCount: typeof o.wordCount === 'number' ? o.wordCount : 0,
  }
}

function asSyncState(raw: unknown): NotesSyncState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  switch (o.phase) {
    case 'idle':
      return { phase: 'idle', lastSyncAt: typeof o.lastSyncAt === 'number' ? o.lastSyncAt : null }
    case 'scanning':
      return { phase: 'scanning' }
    case 'syncing':
      return { phase: 'syncing', up: Number(o.up) || 0, down: Number(o.down) || 0 }
    case 'done':
      return { phase: 'done', up: Number(o.up) || 0, down: Number(o.down) || 0, at: Number(o.at) || Date.now() }
    case 'error':
      return { phase: 'error', message: typeof o.message === 'string' ? o.message : '同步失败' }
    default:
      return null
  }
}

/** 笔记列表 + 同步状态钩子(初始拉取 + 双订阅)。 */
export function useNotes(): {
  notes: NoteListItemView[]
  syncState: NotesSyncState
  reload: () => void
} {
  const [notes, setNotes] = useState<NoteListItemView[]>([])
  const [syncState, setSyncState] = useState<NotesSyncState>({ phase: 'idle', lastSyncAt: null })

  const reload = (): void => {
    void window.amoolink
      .listNotes()
      .then((list) => setNotes(list.map(asNoteListItem).filter((n): n is NoteListItemView => n !== null)))
      .catch(() => undefined)
    void window.amoolink
      .getNotesState()
      .then((s) => {
        const v = asSyncState(s)
        if (v) setSyncState(v)
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    let disposed = false
    void window.amoolink
      .listNotes()
      .then((list) => {
        if (!disposed) {
          setNotes(list.map(asNoteListItem).filter((n): n is NoteListItemView => n !== null))
        }
      })
      .catch(() => undefined)
    void window.amoolink
      .getNotesState()
      .then((s) => {
        if (disposed) return
        const v = asSyncState(s)
        if (v) setSyncState(v)
      })
      .catch(() => undefined)
    const offChanged = window.amoolink.onNotesChanged((items) => {
      if (disposed) return
      setNotes(items.map(asNoteListItem).filter((n): n is NoteListItemView => n !== null))
    })
    const offState = window.amoolink.onNotesState((s) => {
      if (disposed) return
      const v = asSyncState(s)
      if (v) setSyncState(v)
    })
    return () => {
      disposed = true
      offChanged()
      offState()
    }
  }, [])

  return { notes, syncState, reload }
}
