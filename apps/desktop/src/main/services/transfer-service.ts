import { BrowserWindow } from 'electron'
import { createReadStream, createWriteStream, statSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { deviceService } from './device-service'
import { settingsStore } from '../settings-store'
import { joinRemote } from './file-service'

export type TransferState = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface TransferTask {
  id: string
  serial: string
  direction: 'upload' | 'download'
  fileName: string
  localPath: string
  remotePath: string
  size: number
  transferred: number
  state: TransferState
  error?: string
  /** APK 安装任务:上传完成后执行 install -r。 */
  isInstall: boolean
  startedAt?: number
  finishedAt?: number
}

/** 上传任务句柄(运行中可取消)。 */
interface RunningHandle {
  cancel(): unknown
}

const PROGRESS_THROTTLE_MS = 200
/** M2 串行调度:adb sync 通道逐任务执行,稳定优先(并行度提升列入 M4 优化)。 */

class TransferService {
  private tasks = new Map<string, TransferTask>()
  private order: string[] = []
  private running: { task: TransferTask; handle: RunningHandle } | null = null
  private lastBroadcast = 0
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null

  list(): TransferTask[] {
    return this.order.map((id) => this.tasks.get(id)).filter((t): t is TransferTask => !!t)
  }

  /** 入队上传;remoteDir 缺省 /sdcard/Download。.apk 自动追加安装。 */
  async enqueueUpload(serial: string, localPaths: string[], remoteDir?: string): Promise<TransferTask[]> {
    const dir = remoteDir ?? '/sdcard/Download'
    const created: TransferTask[] = []
    for (const localPath of localPaths) {
      let size = 0
      try {
        size = statSync(localPath).size
      } catch {
        continue // 本地文件消失,跳过
      }
      const task: TransferTask = {
        id: randomUUID(),
        serial,
        direction: 'upload',
        fileName: basename(localPath),
        localPath,
        remotePath: joinRemote(dir, basename(localPath)),
        size,
        transferred: 0,
        state: 'queued',
        isInstall: /\.apk$/i.test(localPath),
      }
      this.tasks.set(task.id, task)
      this.order.push(task.id)
      created.push(task)
    }
    this.broadcast(true)
    this.pump()
    return created
  }

  /** 入队下载;localDir 缺省设置中的接收目录(再缺省 ~/Downloads/AmooLink)。 */
  async enqueueDownload(
    serial: string,
    files: Array<{ remotePath: string; name: string; size: number }>,
    localDir?: string,
  ): Promise<TransferTask[]> {
    const dir = localDir ?? (settingsStore.get().files.downloadDir || defaultDownloadDir())
    mkdirSync(dir, { recursive: true })
    const created: TransferTask[] = []
    for (const f of files) {
      const task: TransferTask = {
        id: randomUUID(),
        serial,
        direction: 'download',
        fileName: f.name,
        localPath: join(dir, f.name),
        remotePath: f.remotePath,
        size: f.size,
        transferred: 0,
        state: 'queued',
        isInstall: false,
      }
      this.tasks.set(task.id, task)
      this.order.push(task.id)
      created.push(task)
    }
    this.broadcast(true)
    this.pump()
    return created
  }

  cancel(id: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    if (task.state === 'running' && this.running?.task.id === id) {
      try {
        this.running.handle.cancel()
      } catch {
        // 底层可能已结束
      }
      task.state = 'canceled'
      task.finishedAt = Date.now()
      this.running = null
    } else if (task.state === 'queued') {
      task.state = 'canceled'
      task.finishedAt = Date.now()
    }
    this.broadcast(true)
    this.pump()
  }

  retry(id: string): void {
    const task = this.tasks.get(id)
    if (!task || (task.state !== 'failed' && task.state !== 'canceled')) return
    task.state = 'queued'
    task.transferred = 0
    task.error = undefined
    this.broadcast(true)
    this.pump()
  }

  /** 清理已完成/取消/失败的历史任务。 */
  clearFinished(): void {
    for (const id of this.order) {
      const t = this.tasks.get(id)
      if (t && t.state !== 'queued' && t.state !== 'running') {
        this.tasks.delete(id)
      }
    }
    this.order = this.order.filter((id) => this.tasks.has(id))
    this.broadcast(true)
  }

  /** 等待全部任务到达终态(集成测试用)。 */
  async waitIdle(timeoutMs = 60000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const busy = this.list().some((t) => t.state === 'queued' || t.state === 'running')
      if (!busy && !this.running) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  }

  // ── 调度 ──────────────────────────────────────────────

  private pump(): void {
    if (this.running) return
    const next = this.list().find((t) => t.state === 'queued')
    if (!next) return
    void this.run(next)
  }

  private async run(task: TransferTask): Promise<void> {
    const client = await deviceService.getDeviceClient(task.serial)
    if (!client) {
      task.state = 'failed'
      task.error = '设备已断开'
      this.broadcast(true)
      this.pump()
      return
    }
    task.state = 'running'
    task.startedAt = Date.now()
    this.broadcast(true)
    try {
      if (task.direction === 'upload') {
        const transfer = await client.push(createReadStream(task.localPath), task.remotePath, 0o644)
        this.running = { task, handle: transfer }
        transfer.on('progress', (stats: { bytesTransferred: number }) => {
          task.transferred = stats.bytesTransferred
          this.broadcast()
        })
        await transfer.waitForEnd()
        if (task.isInstall) {
          await client.install(task.localPath)
        }
      } else {
        const transfer = await client.pull(task.remotePath)
        this.running = { task, handle: transfer }
        transfer.on('data', (chunk: Buffer) => {
          task.transferred += chunk.length
          this.broadcast()
        })
        const out = createWriteStream(task.localPath)
        transfer.pipe(out)
        await new Promise<void>((resolve, reject) => {
          out.on('finish', () => resolve())
          out.on('error', reject)
          transfer.on('error', reject)
        })
      }
      if (task.state === 'running') {
        task.state = 'done'
        task.transferred = task.size
        task.finishedAt = Date.now()
      }
    } catch (err) {
      if (task.state === 'running') {
        task.state = 'failed'
        task.error = err instanceof Error ? err.message : String(err)
        task.finishedAt = Date.now()
      }
    } finally {
      if (this.running?.task.id === task.id) this.running = null
      this.broadcast(true)
      this.pump()
    }
  }

  private broadcast(force = false): void {
    const now = Date.now()
    if (!force) {
      if (now - this.lastBroadcast < PROGRESS_THROTTLE_MS) {
        if (!this.broadcastTimer) {
          this.broadcastTimer = setTimeout(() => {
            this.broadcastTimer = null
            this.broadcast(true)
          }, PROGRESS_THROTTLE_MS)
        }
        return
      }
    }
    this.lastBroadcast = now
    const tasks = this.list()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('amoolink:transfer:updated', tasks)
    }
  }
}

function defaultDownloadDir(): string {
  return join(process.env['HOME'] ?? '.', 'Downloads', 'AmooLink')
}

export const transferService = new TransferService()
