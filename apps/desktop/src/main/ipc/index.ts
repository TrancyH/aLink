import { ipcMain, shell, nativeImage, BrowserWindow } from 'electron'
import { app } from 'electron'
import { join } from 'node:path'
import { deviceService } from '../services/device-service'
import { mirrorService, type ControlAction } from '../services/mirror-service'
import { transferService } from '../services/transfer-service'
import { listDir, deletePath, QUICK_DIRS } from '../services/file-service'
import { clipboardService } from '../services/clipboard-service'
import { notifyService } from '../services/notify-service'
import { wirelessService } from '../services/wireless-service'
import { appsService } from '../services/apps-service'
import { noteService } from '../services/note-service'
import { settingsStore, type AppSettings } from '../settings-store'

/**
 * 类型化 IPC 注册表。命名规范 amoolink:<domain>:<action>(详见 docs/02 §2)。
 * 渲染进程侧的类型声明见 src/renderer/env.d.ts,两端保持一致。
 */
export function registerIpc(): void {
  ipcMain.handle('amoolink:device:list', () => deviceService.list())

  ipcMain.handle('amoolink:device:refresh', async () => {
    await deviceService.refresh()
    return deviceService.list()
  })

  ipcMain.handle('amoolink:app:info', () => ({
    name: 'AmooLink',
    version: app.getVersion(),
    electron: process.versions['electron'],
    node: process.versions['node'],
    chrome: process.versions['chrome'],
    platform: process.platform,
  }))

  // ── 投屏(M1)───────────────────────────────────────────
  ipcMain.handle('amoolink:mirror:start', async (_event, serial: string) => {
    await mirrorService.startMirror(serial)
    return { ok: true }
  })

  ipcMain.handle('amoolink:mirror:stop', (_event, serial: string) => {
    mirrorService.stopMirror(serial)
    return { ok: true }
  })

  ipcMain.handle('amoolink:mirror:list', () => mirrorService.listSessions())

  ipcMain.handle('amoolink:mirror:pin', (_event, serial: string, pinned: boolean) => {
    mirrorService.setPinned(serial, pinned)
    return { ok: true }
  })

  ipcMain.on('amoolink:mirror:control', (event, serial: string, action: ControlAction) => {
    mirrorService.handleControl(event.sender, serial, action)
  })

  // ── 设置(M1)───────────────────────────────────────────
  ipcMain.handle('amoolink:settings:get', () => settingsStore.get())

  ipcMain.handle('amoolink:settings:set', async (_event, patch: Partial<AppSettings>) => {
    const next: AppSettings = await settingsStore.set(patch)
    // 托盘/开机自启即时生效(经 IPC 层触发 main 编排,避免循环依赖)
    const emitSettingsChanged = process.emit as (ev: string, v?: unknown) => boolean
    emitSettingsChanged('amoolink:settings-changed', next)
    return next
  })

  // ── 文件与传输(M2)─────────────────────────────────────
  ipcMain.handle('amoolink:files:list', async (_e, serial: string, path: string) => {
    const client = await deviceService.getDeviceClient(serial)
    if (!client) throw new Error('设备不可用')
    return { path, entries: await listDir(client, path) }
  })

  ipcMain.handle('amoolink:files:delete', async (_e, serial: string, path: string) => {
    const client = await deviceService.getDeviceClient(serial)
    if (!client) throw new Error('设备不可用')
    await deletePath(client, path)
    return { ok: true }
  })

  ipcMain.handle('amoolink:files:quick-dirs', () => QUICK_DIRS)

  ipcMain.handle('amoolink:transfer:upload', (_e, serial: string, localPaths: string[], remoteDir?: string) =>
    transferService.enqueueUpload(serial, localPaths, remoteDir),
  )

  ipcMain.handle(
    'amoolink:transfer:download',
    (_e, serial: string, files: Array<{ remotePath: string; name: string; size: number }>) =>
      transferService.enqueueDownload(serial, files),
  )

  ipcMain.handle('amoolink:transfer:list', () => transferService.list())

  ipcMain.handle('amoolink:transfer:cancel', (_e, id: string) => {
    transferService.cancel(id)
    return { ok: true }
  })

  ipcMain.handle('amoolink:transfer:retry', (_e, id: string) => {
    transferService.retry(id)
    return { ok: true }
  })

  ipcMain.handle('amoolink:transfer:clear-finished', () => {
    transferService.clearFinished()
    return { ok: true }
  })

  ipcMain.handle('amoolink:transfer:open-dir', async (_e, dir: string) => {
    await shell.openPath(dir)
    return { ok: true }
  })

  // ── 剪贴板与截图(M3)─────────────────────────────────
  ipcMain.handle('amoolink:clipboard:pull', async (_e, serial: string) => {
    const text = await clipboardService.pullFromPhone(serial)
    return { text }
  })

  ipcMain.handle('amoolink:clipboard:push', async (_e, serial: string, text?: string) => {
    await clipboardService.pushToPhone(serial, text)
    return { ok: true }
  })

  ipcMain.handle('amoolink:clip:phone-screenshot', async (_e, serial: string) => {
    const saved = await clipboardService.phoneScreenshotToClipboard(serial)
    return { ok: true, saved }
  })

  ipcMain.handle('amoolink:clip:send-image', async (_e, serial: string) => {
    const remotePath = await clipboardService.sendClipboardImageToPhone(serial)
    return { ok: true, remotePath }
  })

  // ── 通知(M3)─────────────────────────────────────────
  ipcMain.handle('amoolink:notify:list', () => notifyService.list())

  // ── 笔记(M6,docs/08)────────────────────────────────
  ipcMain.handle('amoolink:notes:list', () => noteService.list())
  ipcMain.handle('amoolink:notes:get', (_e, id: string) => noteService.get(id))
  ipcMain.handle('amoolink:notes:create', () => noteService.create())
  ipcMain.handle('amoolink:notes:save', (_e, input: { id: string; title: string; markdown: string; pinned?: boolean }) =>
    noteService.save(input))
  ipcMain.handle('amoolink:notes:pin', (_e, id: string, pinned: boolean) => {
    void noteService.pin(id, pinned)
    return { ok: true }
  })
  ipcMain.handle('amoolink:notes:remove', (_e, id: string) => noteService.remove(id))
  ipcMain.handle('amoolink:notes:sync-now', (_e, serial?: string) => noteService.syncNow(serial))
  ipcMain.handle('amoolink:notes:state', () => noteService.getState())
  ipcMain.handle('amoolink:notes:install-app', (_e, serial: string) => noteService.installPhoneApp(serial))

  // ── 录屏保存(批次3)─────────────────────────────────
  ipcMain.handle(
    'amoolink:mirror:save-recording',
    async (_e, serial: string, bytes: Uint8Array, dir: string) => {
      try {
        const target = dir.replace('~', process.env['HOME'] ?? '.')
        const { mkdirSync, writeFileSync } = await import('node:fs')
        mkdirSync(target, { recursive: true })
        const file = join(target, `amoolink-rec-${serial}-${Date.now()}.mp4`)
        writeFileSync(file, bytes)
        return { ok: true, path: file }
      } catch (err) {
        return { ok: false, path: String(err) }
      }
    },
  )

  // ── 无线连接(批次1)────────────────────────────────
  ipcMain.handle('amoolink:wireless:enable', (_e, serial: string) => wirelessService.enableWifi(serial))
  ipcMain.handle('amoolink:wireless:pair', (_e, host: string, port: number, code: string) =>
    wirelessService.pair(host, port, code))
  ipcMain.handle('amoolink:wireless:connect', (_e, host: string, port: number) =>
    wirelessService.connect(host, port))
  ipcMain.handle('amoolink:wireless:discover', () => wirelessService.discover())

  // ── 应用面板(批次2)─────────────────────────────────
  ipcMain.handle('amoolink:apps:list', (_e, serial: string) => appsService.list(serial))
  ipcMain.handle('amoolink:apps:launch', (_e, serial: string, pkg: string) => {
    void appsService.launch(serial, pkg)
    return { ok: true }
  })

  // ── 系统级拖出(M2+ 拖拽增强)────────────────────────
  // renderer 的 dragstart 内同步 send 触发 webContents.startDrag(Electron 官方模式)
  ipcMain.on('amoolink:transfer:start-drag', (event, files: string[]) => {
    if (!Array.isArray(files) || files.length === 0) return
    // 44×44 蓝底白箭头拖拽图标(构建时生成的合法 PNG)
    const icon = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAAb0lEQVR42u3ZMQ4AEBBE0T2d1v0P4Bx0GiGIxA5/kulfuztmg8SQ8o3aam5Bl+FeoFNwr9guWgrsHdugpcAq2IoGDBgwYMCAAY+6E8CAAR/saSBgwIABAwYM+C8wJ5LyB1P3oc3G8fuS9M6wqDDdFrdxoWJfXdpCAAAAAElFTkSuQmCC',
        'base64',
      ),
      { width: 44, height: 44 },
    )
    event.sender.startDrag({ file: files[0] as string, files, icon })
  })
}
