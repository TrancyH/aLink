import { app, BrowserWindow, shell, Tray, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { deviceService } from './services/device-service'
import { mirrorService } from './services/mirror-service'
import { transferService } from './services/transfer-service'
import { notifyService } from './services/notify-service'
import { clipboardService } from './services/clipboard-service'
import { noteService } from './services/note-service'
import { settingsStore } from './settings-store'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'AmooLink',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })
  mainWindow.webContents.on('console-message', (_e, _level, message, _line, sourceId) => {
    if (/error|uncaught|failed/i.test(message)) {
      console.error(`[main-renderer] ${message} (${sourceId})`)
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function wireServices(): void {
  deviceService.onUpdate((devices) => {
    const first = devices.find((d) => d.state === 'device')
    if (first) notifyService.start(first.serial)
    else notifyService.stop()
    noteService.onDevices(devices) // M6:笔记自动同步随设备上下线
  })
  const syncAutoClipboard = (serial: string): void => {
    if (settingsStore.get().privacy.clipboardSyncMode === 'auto') {
      clipboardService.startAuto(serial)
    }
  }
  mirrorService.on('session-started', (serial: string) => syncAutoClipboard(serial))
  mirrorService.on('session-stopped', () => clipboardService.stopAuto())
  const onSettingsChanged = (): void => {
    syncTray()
    syncAutoStart()
    noteService.onSettingsChanged()
  }
  process.on('amoolink:settings-changed', onSettingsChanged)
}

let tray: Tray | null = null

function focusMain(): void {
  const win = BrowserWindow.getAllWindows().find((w) => w === mainWindow)
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function syncTray(): void {
  const enabled = settingsStore.get().general.tray
  if (enabled && !tray) {
    const icon = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAAb0lEQVR42u3ZMQ4AEBBE0T2d1v0P4Bx0GiGIxA5/kulfuztmg8SQ8o3aam5Bl+FeoFNwr9guWgrsHdugpcAq2IoGDBgwYMCAAY+6E8CAAR/saSBgwIABAwYM+C8wJ5LyB1P3oc3G8fuS9M6wqDDdFrdxoWJfXdpCAAAAAElFTkSuQmCC',
        'base64',
      ),
      { width: 44, height: 44 },
    )
    tray = new Tray(icon)
    tray.setToolTip('AmooLink')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => focusMain() },
        { type: 'separator' },
        { label: '退出 AmooLink', click: () => app.exit(0) },
      ]),
    )
    tray.on('click', () => focusMain())
  } else if (!enabled && tray) {
    tray.destroy()
    tray = null
  }
}

function syncAutoStart(): void {
  app.setLoginItemSettings({
    openAtLogin: settingsStore.get().general.autoStart,
    args: ['--hidden'],
  })
}

async function runM3Autotest(serial: string): Promise<void> {
  console.log(`[AmooLink][autotest] m3 模式:${serial}`)
  const { execOut } = await import('@amoolink/adb')
  const client = await deviceService.getDeviceClient(serial)
  if (!client) return
  const title = `AmooLinkE2E${Date.now().toString().slice(-5)}`
  await execOut(client, `cmd notification post -t '${title}' m3e2e 'M3 E2E 通知同步验证'`)
  console.log(`[AmooLink][autotest] 已构造通知:${title}`)
  setTimeout(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      void win.webContents.executeJavaScript("location.hash='#/notifications'").catch(() => undefined)
    }
  }, 4000)
  setTimeout(() => {
    void execOut(client, 'cmd notification cancel m3e2e').catch(() => undefined)
  }, 20000)
}

async function runFilesAutotest(serial: string): Promise<void> {
  console.log(`[AmooLink][autotest] files 模式:${serial}`)
  const big = join(tmpdir(), 'amoolink-e2e-big.bin')
  const small = join(tmpdir(), 'amoolink-e2e-small.txt')
  await writeFile(big, Buffer.alloc(256 * 1024).fill(0xab))
  await writeFile(small, 'AmooLink E2E 文件互传测试\n')
  const tasks = await transferService.enqueueUpload(serial, [big, small])
  console.log(`[AmooLink][autotest] 已入队 ${tasks.length} 个上传任务`)
  setTimeout(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      void win.webContents.executeJavaScript("location.hash='#/transfers'").catch(() => undefined)
    }
  }, 3000)
  setTimeout(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      void win.webContents.executeJavaScript("location.hash='#/files'").catch(() => undefined)
    }
  }, 12000)
}

async function runRecAutotest(serial: string): Promise<void> {
  console.log(`[AmooLink][autotest] rec 模式:${serial}`)
  await Promise.race([
    mirrorService.startMirror(serial).catch((e: unknown) =>
      console.error('[AmooLink][autotest] 投屏失败:', e),
    ),
    new Promise((r) => setTimeout(r, 25000)),
  ])
  console.log('[AmooLink][autotest] rec: 投屏发起完成,等待渲染 DOM 就绪')
  await new Promise((r) => setTimeout(r, 4000))
  let mirrorWin: BrowserWindow | undefined
  for (let i = 0; i < 18; i++) {
    mirrorWin = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('投屏'))
    if (mirrorWin) {
      const n = await mirrorWin.webContents
        .executeJavaScript('document.querySelectorAll("button").length')
        .catch(() => 0)
      if (Number(n) > 0) break
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (!mirrorWin) {
    console.error('[AmooLink][autotest] rec: 未找到投屏窗口')
    return
  }
  const win = mirrorWin
  const click = async (sel: string): Promise<unknown> =>
    win.webContents.executeJavaScript(
      `(() => { const b = document.querySelector('${sel}'); if (b) { b.click(); return 'clicked' } return 'notfound' })()`,
    )
  const start = await click('[title*="录屏保存"]')
  console.log(`[AmooLink][autotest] ⏺ ${String(start)}`)
  if (start !== 'clicked') return
  await new Promise((r) => setTimeout(r, 10000))
  const titleMark = await win.webContents.executeJavaScript('document.title').catch(() => 'err')
  console.log('[AmooLink][autotest] 点击后 document.title =', String(titleMark))
  const stop = await click('[title*="停止录屏"]')
  console.log(`[AmooLink][autotest] ⏹ ${String(stop)}`)
  await new Promise((r) => setTimeout(r, 4000))
  console.log('[AmooLink][autotest] rec 完成')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    registerIpc()
    wireServices()
    syncTray()
    syncAutoStart()
    try {
      await deviceService.start()
    } catch (err) {
      console.error('[AmooLink] 设备服务启动失败:', err)
    }
    createMainWindow()

    const autotest = process.env['AMOOLINK_AUTOTEST']
    if (autotest && autotest !== '0') {
      let fired = false
      const autoStartOnce = (devices: Array<{ serial: string; state: string }>): void => {
        if (fired) return
        const first =
          devices.find((d) => d.state === 'device' && d.serial.startsWith('ZYP')) ??
          devices.find((d) => d.state === 'device')
        if (!first) return
        fired = true
        console.log(`[AmooLink][autotest] 选定设备:${first.serial}`)
        if (autotest === '1') {
          void mirrorService.startMirror(first.serial).catch((e: unknown) =>
            console.error('[AmooLink][autotest] 自动投屏失败:', e),
          )
        } else if (autotest === 'files') {
          void runFilesAutotest(first.serial)
        } else if (autotest === 'rec') {
          void runRecAutotest(first.serial)
        } else if (autotest === 'notes') {
          // M6 E2E:直达笔记页;窗口加载时序不定,轮询直到路由生效
          const jump = (n: number): void => {
            const win = mainWindow
            if (n <= 0 || !win || win.isDestroyed()) return
            win.webContents
              .executeJavaScript("location.hash='#/notes'; location.hash")
              .then((v) => {
                if (v !== '#/notes') setTimeout(() => jump(n - 1), 1000)
                else console.log('[AmooLink][autotest] 已切到笔记页')
              })
              .catch(() => setTimeout(() => jump(n - 1), 1000))
          }
          jump(8)
        } else {
          void runM3Autotest(first.serial)
        }
      }
      const existing = deviceService.list()
      if (existing.length > 0) autoStartOnce(existing)
      else deviceService.onUpdate(autoStartOnce)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (tray) return
    mirrorService.stopAll()
    deviceService.stop()
    app.quit()
  })
}
