import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { DeviceInfo } from '@amoolink/adb'
import type { NoteFile, NoteListItem, SyncState } from '@amoolink/notes-editor'
import type { AppSettings } from '../main/settings-store'
import type { ControlAction } from '../main/services/mirror-service'

/** 镜像窗口收到的视频帧载荷(主进程广播)。 */
export interface MirrorFramePayload {
  serial: string
  payload: { data: Uint8Array; ptsUs: number; keyframe: boolean }
}

export interface MirrorConfigPayload {
  serial: string
  payload: {
    raw: Uint8Array
    profileIndex: number
    constraintSet: number
    levelIndex: number
    width: number
    height: number
  }
}

export interface MirrorStatePayload {
  serial: string
  payload: {
    state: 'starting' | 'streaming' | 'retrying' | 'error' | 'stopped'
    meta?: { deviceName: string; codec: string; width: number; height: number }
    message?: string
    attempt?: number
  }
}

export interface MirrorStatsPayload {
  serial: string
  payload: { fps: number; kbps: number }
}

/**
 * 渲染进程可用的类型化 API(preload 桥)。
 * 渲染侧声明见 src/renderer/env.d.ts;新增频道时两处同步更新。
 */
const api = {
  getDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke('amoolink:device:list'),
  refreshDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke('amoolink:device:refresh'),
  getAppInfo: (): Promise<{
    name: string
    version: string
    electron: string
    node: string
    chrome: string
    platform: string
  }> => ipcRenderer.invoke('amoolink:app:info'),

  /** 订阅设备列表变化,返回取消订阅函数。 */
  onDevicesChanged: (callback: (devices: DeviceInfo[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, devices: DeviceInfo[]): void => callback(devices)
    ipcRenderer.on('amoolink:device:changed', listener)
    return () => {
      ipcRenderer.removeListener('amoolink:device:changed', listener)
    }
  },

  // ── 投屏(M1)───────────────────────────────────────────
  startMirror: (serial: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:mirror:start', serial),
  stopMirror: (serial: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:mirror:stop', serial),
  sendMirrorControl: (serial: string, action: ControlAction): void => {
    ipcRenderer.send('amoolink:mirror:control', serial, action)
  },
  setMirrorPinned: (serial: string, pinned: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:mirror:pin', serial, pinned),

  onMirrorFrame: (callback: (msg: MirrorFramePayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, msg: MirrorFramePayload): void => callback(msg)
    ipcRenderer.on('amoolink:mirror:frame', listener)
    return () => ipcRenderer.removeListener('amoolink:mirror:frame', listener)
  },
  onMirrorConfig: (callback: (msg: MirrorConfigPayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, msg: MirrorConfigPayload): void => callback(msg)
    ipcRenderer.on('amoolink:mirror:config', listener)
    return () => ipcRenderer.removeListener('amoolink:mirror:config', listener)
  },
  onMirrorState: (callback: (msg: MirrorStatePayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, msg: MirrorStatePayload): void => callback(msg)
    ipcRenderer.on('amoolink:mirror:state', listener)
    return () => ipcRenderer.removeListener('amoolink:mirror:state', listener)
  },
  onMirrorStats: (callback: (msg: MirrorStatsPayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, msg: MirrorStatsPayload): void => callback(msg)
    ipcRenderer.on('amoolink:mirror:stats', listener)
    return () => ipcRenderer.removeListener('amoolink:mirror:stats', listener)
  },
  onMirrorToast: (callback: (msg: { serial: string; payload: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, msg: { serial: string; payload: string }): void =>
      callback(msg)
    ipcRenderer.on('amoolink:mirror:toast', listener)
    return () => ipcRenderer.removeListener('amoolink:mirror:toast', listener)
  },

  // ── 设置(M1)───────────────────────────────────────────
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('amoolink:settings:get'),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('amoolink:settings:set', patch),

  // ── 文件与传输(M2)─────────────────────────────────────
  listDeviceDir: (
    serial: string,
    path: string,
  ): Promise<{ path: string; entries: Array<{ name: string; isDir: boolean; size: number; mtimeMs: number }> }> =>
    ipcRenderer.invoke('amoolink:files:list', serial, path),
  deleteDevicePath: (serial: string, path: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:files:delete', serial, path),
  uploadFiles: (
    serial: string,
    localPaths: string[],
    remoteDir?: string,
  ): Promise<Array<{ id: string; fileName: string }>> =>
    ipcRenderer.invoke('amoolink:transfer:upload', serial, localPaths, remoteDir),
  downloadFiles: (
    serial: string,
    files: Array<{ remotePath: string; name: string; size: number }>,
  ): Promise<Array<{ id: string; fileName: string }>> =>
    ipcRenderer.invoke('amoolink:transfer:download', serial, files),
  listTransfers: () => ipcRenderer.invoke('amoolink:transfer:list'),
  cancelTransfer: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:transfer:cancel', id),
  retryTransfer: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:transfer:retry', id),
  clearFinishedTransfers: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:transfer:clear-finished'),
  openDirectory: (dir: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:transfer:open-dir', dir),
  onTransfersUpdated: (callback: (tasks: unknown[]) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, tasks: unknown[]): void => callback(tasks)
    ipcRenderer.on('amoolink:transfer:updated', listener)
    return () => ipcRenderer.removeListener('amoolink:transfer:updated', listener)
  },

  // ── 剪贴板与截图(M3)─────────────────────────────────
  pullPhoneClipboard: (serial: string): Promise<{ text: string }> =>
    ipcRenderer.invoke('amoolink:clipboard:pull', serial),
  pushClipboardToPhone: (serial: string, text?: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:clipboard:push', serial, text),
  phoneScreenshot: (serial: string): Promise<{ ok: boolean; saved: string }> =>
    ipcRenderer.invoke('amoolink:clip:phone-screenshot', serial),
  sendClipboardImage: (serial: string): Promise<{ ok: boolean; remotePath: string }> =>
    ipcRenderer.invoke('amoolink:clip:send-image', serial),

  // ── 通知(M3)─────────────────────────────────────────
  listNotifications: (): Promise<
    Array<{ key: string; pkg: string; title: string; text: string; whenMs: number; importance: string }>
  > => ipcRenderer.invoke('amoolink:notify:list'),
  onNotificationNew: (
    callback: (item: { key: string; pkg: string; title: string; text: string; whenMs: number; importance: string }) => void,
  ): (() => void) => {
    const listener = (
      _e: IpcRendererEvent,
      item: { key: string; pkg: string; title: string; text: string; whenMs: number; importance: string },
    ): void => callback(item)
    ipcRenderer.on('amoolink:notify:new', listener)
    return () => ipcRenderer.removeListener('amoolink:notify:new', listener)
  },

  // ── 通知按 App 免打扰(docs/03 §6)─────────────────────
  listMutedApps: (): Promise<string[]> => ipcRenderer.invoke('amoolink:notify:muted-list'),
  setNotifyMuted: (pkg: string, muted: boolean): Promise<string[]> =>
    ipcRenderer.invoke('amoolink:notify:set-muted', pkg, muted),
  onNotifyMutedChanged: (callback: (mutedApps: string[]) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, mutedApps: string[]): void => callback(mutedApps)
    ipcRenderer.on('amoolink:notify:muted-changed', listener)
    return () => ipcRenderer.removeListener('amoolink:notify:muted-changed', listener)
  },

  // ── 系统级拖出(M2+ 拖拽增强;须在 dragstart 同步链路内调用)──
  startFileDrag: (files: string[]): void => {
    ipcRenderer.send('amoolink:transfer:start-drag', files)
  },

  // ── 无线连接(批次1)─────────────────────────────────
  wirelessEnable: (serial: string): Promise<{ ip: string; port: number }> =>
    ipcRenderer.invoke('amoolink:wireless:enable', serial),
  wirelessPair: (host: string, port: number, code: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('amoolink:wireless:pair', host, port, code),
  wirelessConnect: (host: string, port: number): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('amoolink:wireless:connect', host, port),
  wirelessDiscover: (): Promise<
    Array<{ kind: 'connect' | 'pairing'; host: string; port: number; instance: string }>
  > => ipcRenderer.invoke('amoolink:wireless:discover'),

  // ── 投屏音频/录屏(批次3)────────────────────────────
  onMirrorAudioMeta: (callback: (msg: { serial: string; payload: { codecId: number } }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, msg: { serial: string; payload: { codecId: number } }): void =>
      callback(msg)
    ipcRenderer.on('amoolink:mirror:audio-meta', listener)
    return () => ipcRenderer.removeListener('amoolink:mirror:audio-meta', listener)
  },
  onMirrorAudioConfig: (
    callback: (msg: { serial: string; payload: { raw: Uint8Array } }) => void,
  ): (() => void) => {
    const listener = (_e: IpcRendererEvent, msg: { serial: string; payload: { raw: Uint8Array } }): void =>
      callback(msg)
    ipcRenderer.on('amoolink:mirror:audio-config', listener)
    return () => ipcRenderer.removeListener('amoolink:mirror:audio-config', listener)
  },
  onMirrorAudioFrame: (
    callback: (msg: { serial: string; payload: { data: Uint8Array; ptsUs: number } }) => void,
  ): (() => void) => {
    const listener = (
      _e: IpcRendererEvent,
      msg: { serial: string; payload: { data: Uint8Array; ptsUs: number } },
    ): void => callback(msg)
    ipcRenderer.on('amoolink:mirror:audio-frame', listener)
    return () => ipcRenderer.removeListener('amoolink:mirror:audio-frame', listener)
  },
  saveRecording: (serial: string, bytes: Uint8Array, dir: string): Promise<{ ok: boolean; path: string }> =>
    ipcRenderer.invoke('amoolink:mirror:save-recording', serial, bytes, dir),

  // ── 伴侣 APK 通道(M5)────────────────────────────────
  companionStatus: (): Promise<
    Array<{ id: string; name: string; connected: boolean; pairedAt: number; lastSeenAt?: number }>
  > => ipcRenderer.invoke('amoolink:companion:status'),
  companionPair: (ip: string, port: number, otp: string): Promise<{ sas: string; phoneName: string }> =>
    ipcRenderer.invoke('amoolink:companion:pair', ip, port, otp),
  companionForget: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:companion:forget', id),
  companionReply: (phoneId: string, key: string, actionIdx: number, inputKey: string, text: string): Promise<void> =>
    ipcRenderer.invoke('amoolink:companion:reply', phoneId, key, actionIdx, inputKey, text),
  companionSms: (
    phoneId: string,
    max?: number,
  ): Promise<Array<{ id: number; address: string; body: string; dateMs: number; type: number }>> =>
    ipcRenderer.invoke('amoolink:companion:sms', phoneId, max),
  companionContacts: (
    phoneId: string,
    max?: number,
  ): Promise<Array<{ id: number; name: string; phones: string[] }>> =>
    ipcRenderer.invoke('amoolink:companion:contacts', phoneId, max),
  companionSendClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke('amoolink:companion:send-clipboard', text),
  companionPullClipboard: (): Promise<string> =>
    ipcRenderer.invoke('amoolink:companion:pull-clipboard'),
  companionHistory: (phoneId: string): Promise<string[]> =>
    ipcRenderer.invoke('amoolink:companion:history', phoneId),
  onCompanionEvent: (channel: string, callback: (payload: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  // ── 应用面板(批次2)─────────────────────────────────
  listApps: (serial: string): Promise<Array<{ pkg: string; label: string }>> =>
    ipcRenderer.invoke('amoolink:apps:list', serial),
  launchApp: (serial: string, pkg: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:apps:launch', serial, pkg),

  // ── 笔记(M6,docs/08)────────────────────────────────
  listNotes: (): Promise<NoteListItem[]> => ipcRenderer.invoke('amoolink:notes:list'),
  getNote: (id: string): Promise<NoteFile | null> => ipcRenderer.invoke('amoolink:notes:get', id),
  createNote: (): Promise<NoteListItem> => ipcRenderer.invoke('amoolink:notes:create'),
  saveNote: (input: { id: string; title: string; markdown: string; pinned?: boolean }): Promise<NoteFile | null> =>
    ipcRenderer.invoke('amoolink:notes:save', input),
  pinNote: (id: string, pinned: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('amoolink:notes:pin', id, pinned),
  removeNote: (id: string): Promise<void> => ipcRenderer.invoke('amoolink:notes:remove', id),
  listTrashedNotes: (): Promise<NoteListItem[]> => ipcRenderer.invoke('amoolink:notes:trash-list'),
  restoreNote: (id: string): Promise<NoteFile | null> => ipcRenderer.invoke('amoolink:notes:restore', id),
  openNoteOnPhone: (serial: string, id: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('amoolink:notes:open-on-phone', serial, id),
  syncNotesNow: (serial?: string): Promise<SyncState> => ipcRenderer.invoke('amoolink:notes:sync-now', serial),
  getNotesState: (): Promise<SyncState> => ipcRenderer.invoke('amoolink:notes:state'),
  installNotesApp: (serial: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('amoolink:notes:install-app', serial),
  onNotesChanged: (callback: (items: NoteListItem[]) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, items: NoteListItem[]): void => callback(items)
    ipcRenderer.on('amoolink:notes:changed', listener)
    return () => ipcRenderer.removeListener('amoolink:notes:changed', listener)
  },
  onNotesState: (callback: (state: SyncState) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, state: SyncState): void => callback(state)
    ipcRenderer.on('amoolink:notes:state', listener)
    return () => ipcRenderer.removeListener('amoolink:notes:state', listener)
  },
}

export type AmoolinkApi = typeof api
contextBridge.exposeInMainWorld('amoolink', api)

// 拖拽上传需要 File → 本地路径(Electron 32+ 移除了 File.path,须走 webUtils)
contextBridge.exposeInMainWorld('amoolinkFiles', {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
})
