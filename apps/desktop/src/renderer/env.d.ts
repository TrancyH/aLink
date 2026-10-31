/// <reference types="vite/client" />
import type { DeviceInfo } from '@amoolink/adb'
import type { NoteFile, NoteListItem, SyncState } from '@amoolink/notes-editor'
import type { AppSettings } from '../../main/settings-store'
import type { ControlAction } from '../../main/services/mirror-service'

/** preload 桥类型声明(与 src/preload/index.ts 保持一致)。 */
declare global {
  interface Window {
    amoolink: {
      getDevices(): Promise<DeviceInfo[]>
      refreshDevices(): Promise<DeviceInfo[]>
      getAppInfo(): Promise<{
        name: string
        version: string
        electron: string
        node: string
        chrome: string
        platform: string
      }>
      onDevicesChanged(callback: (devices: DeviceInfo[]) => void): () => void

      startMirror(serial: string): Promise<{ ok: boolean }>
      stopMirror(serial: string): Promise<{ ok: boolean }>
      sendMirrorControl(serial: string, action: ControlAction): void
      setMirrorPinned(serial: string, pinned: boolean): Promise<{ ok: boolean }>
      onMirrorFrame(callback: (msg: {
        serial: string
        payload: { data: Uint8Array; ptsUs: number; keyframe: boolean }
      }) => void): () => void
      onMirrorConfig(callback: (msg: {
        serial: string
        payload: {
          raw: Uint8Array
          profileIndex: number
          constraintSet: number
          levelIndex: number
          width: number
          height: number
        }
      }) => void): () => void
      onMirrorState(callback: (msg: {
        serial: string
        payload: {
          state: 'starting' | 'streaming' | 'retrying' | 'error' | 'stopped'
          meta?: { deviceName: string; codec: string; width: number; height: number }
          message?: string
          attempt?: number
        }
      }) => void): () => void
      onMirrorStats(
        callback: (msg: { serial: string; payload: { fps: number; kbps: number } }) => void,
      ): () => void
      onMirrorToast(
        callback: (msg: { serial: string; payload: string }) => void,
      ): () => void

      getSettings(): Promise<AppSettings>
      setSettings(patch: Partial<AppSettings>): Promise<AppSettings>

      listDeviceDir(
        serial: string,
        path: string,
      ): Promise<{ path: string; entries: Array<{ name: string; isDir: boolean; size: number; mtimeMs: number }> }>
      deleteDevicePath(serial: string, path: string): Promise<{ ok: boolean }>
      uploadFiles(
        serial: string,
        localPaths: string[],
        remoteDir?: string,
      ): Promise<Array<{ id: string; fileName: string }>>
      downloadFiles(
        serial: string,
        files: Array<{ remotePath: string; name: string; size: number }>,
      ): Promise<Array<{ id: string; fileName: string }>>
      listTransfers(): Promise<unknown[]>
      cancelTransfer(id: string): Promise<{ ok: boolean }>
      retryTransfer(id: string): Promise<{ ok: boolean }>
      clearFinishedTransfers(): Promise<{ ok: boolean }>
      openDirectory(dir: string): Promise<{ ok: boolean }>
      onTransfersUpdated(callback: (tasks: unknown[]) => void): () => void

      pullPhoneClipboard(serial: string): Promise<{ text: string }>
      pushClipboardToPhone(serial: string, text?: string): Promise<{ ok: boolean }>
      phoneScreenshot(serial: string): Promise<{ ok: boolean; saved: string }>
      sendClipboardImage(serial: string): Promise<{ ok: boolean; remotePath: string }>
      listNotifications(): Promise<
        Array<{ key: string; pkg: string; title: string; text: string; whenMs: number; importance: string }>
      >
      onNotificationNew(
        callback: (item: {
          key: string
          pkg: string
          title: string
          text: string
          whenMs: number
          importance: string
        }) => void,
      ): () => void
      listMutedApps(): Promise<string[]>
      setNotifyMuted(pkg: string, muted: boolean): Promise<string[]>
      onNotifyMutedChanged(callback: (mutedApps: string[]) => void): () => void
      startFileDrag(files: string[]): void
      wirelessEnable(serial: string): Promise<{ ip: string; port: number }>
      wirelessPair(host: string, port: number, code: string): Promise<{ ok: boolean; message: string }>
      wirelessConnect(host: string, port: number): Promise<{ ok: boolean; message: string }>
      wirelessDiscover(): Promise<
        Array<{ kind: 'connect' | 'pairing'; host: string; port: number; instance: string }>
      >
      companionStatus(): Promise<
        Array<{ id: string; name: string; connected: boolean; pairedAt: number; lastSeenAt?: number }>
      >
      companionPair(ip: string, port: number, otp: string): Promise<{ sas: string; phoneName: string }>
      companionForget(id: string): Promise<{ ok: boolean }>
      companionReply(
        phoneId: string,
        key: string,
        actionIdx: number,
        inputKey: string,
        text: string,
      ): Promise<void>
      companionSms(
        phoneId: string,
        max?: number,
      ): Promise<Array<{ id: number; address: string; body: string; dateMs: number; type: number }>>
      companionContacts(
        phoneId: string,
        max?: number,
      ): Promise<Array<{ id: number; name: string; phones: string[] }>>
      companionSendClipboard(text: string): Promise<void>
      companionPullClipboard(): Promise<string>
      companionHistory(phoneId: string): Promise<string[]>
      onCompanionEvent(channel: string, callback: (payload: unknown) => void): () => void
      listApps(serial: string): Promise<Array<{ pkg: string; label: string }>>
      launchApp(serial: string, pkg: string): Promise<{ ok: boolean }>
      onMirrorAudioMeta(
        callback: (msg: { serial: string; payload: { codecId: number } }) => void,
      ): () => void
      onMirrorAudioConfig(
        callback: (msg: { serial: string; payload: { raw: Uint8Array } }) => void,
      ): () => void
      onMirrorAudioFrame(
        callback: (msg: { serial: string; payload: { data: Uint8Array; ptsUs: number } }) => void,
      ): () => void
      saveRecording(
        serial: string,
        bytes: Uint8Array,
        dir: string,
      ): Promise<{ ok: boolean; path: string }>

      listNotes(): Promise<NoteListItem[]>
      getNote(id: string): Promise<NoteFile | null>
      createNote(): Promise<NoteListItem>
      saveNote(input: { id: string; title: string; markdown: string; pinned?: boolean }): Promise<NoteFile | null>
      pinNote(id: string, pinned: boolean): Promise<{ ok: boolean }>
      removeNote(id: string): Promise<void>
      syncNotesNow(serial?: string): Promise<SyncState>
      getNotesState(): Promise<SyncState>
      installNotesApp(serial: string): Promise<{ ok: boolean; message: string }>
      onNotesChanged(callback: (items: NoteListItem[]) => void): () => void
      onNotesState(callback: (state: SyncState) => void): () => void
    }
    amoolinkFiles: {
      getPathForFile(file: File): string
    }
  }
}

export {}
