import { BrowserWindow, app } from 'electron'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  createNote,
  makeNoteId,
  markdownToText,
  noteExcerpt,
  noteWordCount,
  parseNote,
  planSync,
  mergeManifests,
  serializeNote,
  type Manifest,
  type ManifestEntry,
  type NoteFile,
  type NoteListItem,
  type SyncAction,
  type SyncState,
} from '@amoolink/notes-editor'
import { execOut } from '@amoolink/adb'
import { deviceService } from './device-service'
import { settingsStore } from '../settings-store'

/**
 * 笔记服务(M6,docs/08):
 * - 本地库 userData/notes/*.md(frontmatter 每条一文件)
 * - 同步引擎:5s 轮询连接中的手机,planSync 三方比对(base/local/remote),tombstone 删除,冲突双副本
 * - autoSync 开关关=仅手动 syncNow;全程状态机推给渲染端
 */

const SYNC_INTERVAL_MS = 5000
const REMOTE_NOTES_DIR = '/sdcard/Android/data/com.amoolink.notes/files/notes'
const REMOTE_MANIFEST = `${REMOTE_NOTES_DIR}/manifest.json`
const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000

class NoteService {
  private state: SyncState = { phase: 'idle', lastSyncAt: null }
  private syncing = false
  private timer: ReturnType<typeof setInterval> | null = null
  private serial: string | null = null

  // ── 本地 CRUD ──────────────────────────────────────────

  private get notesDir(): string {
    return join(app.getPath('userData'), 'notes')
  }

  private get manifestPath(): string {
    return join(this.notesDir, 'manifest.json')
  }

  list(): NoteListItem[] {
    const items: NoteListItem[] = []
    try {
      for (const name of readdirSync(this.notesDir)) {
        if (!name.endsWith('.md')) continue
        const note = this.readNoteFile(join(this.notesDir, name))
        if (!note) continue
        items.push(this.toListItem(note))
      }
    } catch {
      // 目录不存在 = 空库
    }
    return items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }

  get(id: string): NoteFile | null {
    try {
      return this.readNoteFile(this.notePath(id))
    } catch {
      return null
    }
  }

  async create(): Promise<NoteListItem> {
    const note = createNote('')
    await this.writeNoteAtomic(note)
    this.broadcastChanged()
    return this.toListItem(note)
  }

  async save(input: { id: string; title: string; markdown: string; pinned?: boolean }): Promise<NoteFile | null> {
    const existing = this.get(input.id)
    if (!existing) return null
    const next: NoteFile = {
      ...existing,
      title: input.title,
      markdown: input.markdown,
      pinned: input.pinned ?? existing.pinned,
      updatedAt: new Date().toISOString(),
    }
    await this.writeNoteAtomic(next)
    this.broadcastChanged()
    return next
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    const existing = this.get(id)
    if (!existing) return
    await this.writeNoteAtomic({ ...existing, pinned, updatedAt: new Date().toISOString() })
    this.broadcastChanged()
  }

  /** 本地删除:落 tombstone 到 manifest(删除随下次同步传播到手机)。 */
  async remove(id: string): Promise<void> {
    await rm(this.notePath(id), { force: true })
    const manifest = await this.readLocalManifest()
    if (manifest.notes[id] && !manifest.notes[id].deletedAt) {
      manifest.notes[id] = { ...manifest.notes[id], deletedAt: Date.now() }
      await this.writeLocalManifest(manifest)
    }
    this.broadcastChanged()
  }

  // ── 同步引擎 ──────────────────────────────────────────

  getState(): SyncState {
    return this.state
  }

  /** wireServices 编排:设备上下线 → 自动同步计时器启停。 */
  onDevices(devices: Array<{ serial: string; state: string }>): void {
    const online = devices.find((d) => d.state === 'device')
    console.log(`[AmooLink][notes] onDevices: ${devices.length} 台,在线=${online?.serial ?? '无'}`)
    if (!online) {
      this.stopTimer()
      return
    }
    if (this.timer && this.serial === online.serial) return
    this.startTimer(online.serial)
  }

  /** 设置变更(autoSync 开关)后重估计时器。 */
  onSettingsChanged(): void {
    if (!this.serial) return
    if (settingsStore.get().notes.autoSync) return // 已有计时器继续
    // 关闭开关:保留计时器由 tick 内判断,保证重新打开后 5s 内生效;此处无需动作
  }

  private startTimer(serial: string): void {
    this.stopTimer()
    this.serial = serial
    this.timer = setInterval(() => void this.tick(), SYNC_INTERVAL_MS)
    void this.tick()
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.serial = null
  }

  private async tick(): Promise<void> {
    if (!settingsStore.get().notes.autoSync) return
    if (this.syncing) return
    if (!this.serial) return
    try {
      await this.syncOnce(this.serial)
    } catch (err) {
      console.error('[AmooLink][notes] 自动同步失败:', err)
    }
  }

  /** 手动/自动同步入口。 */
  async syncNow(serial?: string): Promise<SyncState> {
    const target = serial ?? this.serial
    if (!target) {
      this.setState({ phase: 'error', message: '没有已连接的手机' })
      return this.state
    }
    if (this.syncing) return this.state
    try {
      await this.syncOnce(target)
    } catch (err) {
      this.setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return this.state
  }

  private async syncOnce(serial: string): Promise<void> {
    this.syncing = true
    try {
      console.log(`[AmooLink][notes] syncOnce 开始:${serial}`)
      this.setState({ phase: 'scanning' })
      const client = await deviceService.getDeviceClient(serial)
      if (!client) throw new Error('设备已断开')

      await mkdir(this.notesDir, { recursive: true })
      // 首次同步:manifest 缺失时以当前本地文件为 base 建档
      let localManifest = await this.readLocalManifest()
      if (Object.keys(localManifest.notes).length === 0 && (await this.localFileCount()) > 0) {
        localManifest = await this.rebuildLocalManifest()
      }

      const remoteFiles = await this.remoteListMd5(client)
      const remoteManifest = await this.readRemoteManifest(client)
      const localFiles = await this.localFileMd5s()

      const plan = planSync(
        { files: localFiles, manifest: localManifest.notes },
        { files: remoteFiles, manifest: remoteManifest.notes },
      )
      const mutations = plan.filter((a) => a.type !== 'noop')
      if (mutations.length === 0) {
        const merged = mergeManifests(localManifest.notes, remoteManifest.notes, localFiles, Date.now())
        await this.writeLocalManifest({ version: 1, notes: merged })
        if (JSON.stringify(merged) !== JSON.stringify(remoteManifest.notes)) {
          await this.writeRemoteManifest(client, { version: 1, notes: merged })
        }
        await this.cleanupTombstones()
        this.setState({ phase: 'done', up: 0, down: 0, at: Date.now() })
        return
      }

      this.setState({
        phase: 'syncing',
        up: mutations.filter((a) => a.type === 'push' || a.type === 'delete-remote').length,
        down: mutations.filter((a) => a.type === 'pull' || a.type === 'delete-local').length,
      })

      let up = 0
      let down = 0
      const finalMd5: Record<string, string | null> = {}
      const conflictNotes: NoteFile[] = []

      for (const action of mutations as SyncAction[]) {
        switch (action.type) {
          case 'pull': {
            const md5 = await this.pullNote(client, action.id)
            if (md5) {
              finalMd5[action.id] = md5
              down += 1
            }
            break
          }
          case 'push': {
            const md5 = await this.pushNote(client, action.id)
            if (md5) {
              finalMd5[action.id] = md5
              up += 1
            }
            break
          }
          case 'delete-remote': {
            await execOut(client, `rm -f '${REMOTE_NOTES_DIR}/${action.id}.md'`)
            finalMd5[action.id] = null
            up += 1
            break
          }
          case 'delete-local': {
            await rm(this.notePath(action.id), { force: true })
            finalMd5[action.id] = null
            down += 1
            break
          }
          case 'conflict': {
            const copy = await this.materializeConflictCopy(action.id)
            if (copy) {
              conflictNotes.push(copy)
              const copyMd5 = await this.pushNote(client, copy.id)
              if (copyMd5) {
                finalMd5[copy.id] = copyMd5
                up += 1
              }
            }
            const remoteMd5 = await this.pullNote(client, action.id) // 远端版本占据原 id
            if (remoteMd5) {
              finalMd5[action.id] = remoteMd5
              down += 1
            }
            break
          }
          default:
            break
        }
      }

      const merged = mergeManifests(localManifest.notes, remoteManifest.notes, finalMd5, Date.now())
      await this.writeLocalManifest({ version: 1, notes: merged })
      await this.writeRemoteManifest(client, { version: 1, notes: merged })
      await this.cleanupTombstones()
      this.broadcastChanged()
      this.setState({ phase: 'done', up, down, at: Date.now() })
    } finally {
      this.syncing = false
    }
  }

  /** 冲突副本:本地当前内容另存新 id(`标题-冲突-yyyyMMdd-HHmm`),双方各留完整内容。 */
  private async materializeConflictCopy(id: string): Promise<NoteFile | null> {
    const local = this.get(id)
    if (!local) return null
    const ts = conflictStamp()
    const copy: NoteFile = {
      ...createNote(local.markdown),
      id: makeNoteId(),
      title: `${local.title || '未命名笔记'}-冲突-${ts}`,
      createdAt: local.createdAt,
      updatedAt: new Date().toISOString(),
    }
    await this.writeNoteAtomic(copy)
    return copy
  }

  // ── 远端(adb)访问 ─────────────────────────────────────

  private async remoteListMd5(client: Parameters<typeof execOut>[0]): Promise<Record<string, string>> {
    let out: string
    try {
      out = await execOut(
        client,
        `find '${REMOTE_NOTES_DIR}' -maxdepth 1 -name '*.md' -exec md5sum {} + 2>/dev/null`,
      )
    } catch {
      return {} // 目录尚不存在
    }
    const files: Record<string, string> = {}
    for (const line of out.split('\n')) {
      const m = /^([0-9a-f]{32})\s+(.+\.md)$/.exec(line.trim())
      if (!m) continue
      const id = m[2].split('/').pop()!.replace(/\.md$/, '')
      if (id === 'manifest') continue
      files[id] = m[1]
    }
    return files
  }

  private async readRemoteManifest(client: Parameters<typeof execOut>[0]): Promise<Manifest> {
    try {
      const raw = await execOut(client, `cat '${REMOTE_MANIFEST}' 2>/dev/null`)
      return safeManifest(raw)
    } catch {
      return { version: 1, notes: {} }
    }
  }

  private async writeRemoteManifest(client: Parameters<typeof execOut>[0], manifest: Manifest): Promise<void> {
    await execOut(client, `mkdir -p '${REMOTE_NOTES_DIR}'`)
    const tmp = `${REMOTE_MANIFEST}.tmp`
    const localTmp = await this.writeTmpManifest(manifest)
    const transfer = await client.push(createReadStream(localTmp), tmp, 0o644)
    await transfer.waitForEnd()
    await execOut(client, `mv '${tmp}' '${REMOTE_MANIFEST}'`)
    await rm(localTmp, { force: true }) // 本地中转文件用完即清
  }

  private async pullNote(client: Parameters<typeof execOut>[0], id: string): Promise<string | null> {
    const remote = `${REMOTE_NOTES_DIR}/${id}.md`
    const transfer = await client.pull(remote)
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      transfer.on('data', (chunk: Buffer) => chunks.push(chunk))
      transfer.on('end', () => resolve())
      transfer.on('error', reject)
    })
    const raw = Buffer.concat(chunks).toString('utf8')
    if (!raw.trim()) return null // 空文件异常,不落库
    await this.writeNoteAtomic(parseNote(raw))
    return md5(raw)
  }

  private async pushNote(client: Parameters<typeof execOut>[0], id: string): Promise<string | null> {
    const local = this.notePath(id)
    const raw = await readFile(local, 'utf8').catch(() => null)
    if (raw === null) return null
    await execOut(client, `mkdir -p '${REMOTE_NOTES_DIR}'`)
    const tmp = `${REMOTE_NOTES_DIR}/${id}.md.tmp`
    const transfer = await client.push(createReadStream(local), tmp, 0o644)
    await transfer.waitForEnd()
    await execOut(client, `mv '${tmp}' '${REMOTE_NOTES_DIR}/${id}.md'`)
    return md5(raw)
  }

  // ── 本地存储细节 ───────────────────────────────────────

  private notePath(id: string): string {
    // id 白名单(防路径穿越);冲突副本也是合法 id 形态
    if (!/^[0-9]{8}-[0-9]{6}-[a-z0-9]{5}$/.test(id)) throw new Error(`非法笔记 id:${id}`)
    return join(this.notesDir, `${id}.md`)
  }

  private readNoteFile(path: string): NoteFile | null {
    try {
      const raw = readFileSync(path, 'utf8')
      if (!raw.trim()) return null
      return parseNote(raw)
    } catch {
      return null
    }
  }

  private async writeNoteAtomic(note: NoteFile): Promise<void> {
    await mkdir(this.notesDir, { recursive: true })
    const target = this.notePath(note.id)
    const tmp = `${target}.tmp`
    await writeFile(tmp, serializeNote(note), 'utf8')
    await rename(tmp, target)
  }

  private async readLocalManifest(): Promise<Manifest> {
    try {
      return safeManifest(await readFile(this.manifestPath, 'utf8'))
    } catch {
      return { version: 1, notes: {} }
    }
  }

  private async writeLocalManifest(manifest: Manifest): Promise<void> {
    await mkdir(this.notesDir, { recursive: true })
    await writeFile(this.manifestPath, JSON.stringify(manifest), 'utf8')
  }

  /** writeRemoteManifest 用:先把 manifest 写成本地临时文件再 push。 */
  private async writeTmpManifest(manifest: Manifest): Promise<string> {
    const tmp = join(this.notesDir, 'manifest.push.json')
    await writeFile(tmp, JSON.stringify(manifest), 'utf8')
    return tmp
  }

  private async rebuildLocalManifest(): Promise<Manifest> {
    const files = await this.localFileMd5s()
    const manifest: Manifest = {
      version: 1,
      notes: Object.fromEntries(
        Object.entries(files).map(([id, md5sum]) => [id, { md5: md5sum, mtime: Date.now(), deletedAt: null } satisfies ManifestEntry]),
      ),
    }
    await this.writeLocalManifest(manifest)
    return manifest
  }

  private async localFileMd5s(): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const name of await readdir(this.notesDir)) {
      if (!name.endsWith('.md') || name.endsWith('.tmp')) continue
      const raw = await readFile(join(this.notesDir, name), 'utf8').catch(() => null)
      if (raw === null || !raw.trim()) continue
      out[name.replace(/\.md$/, '')] = md5(raw)
    }
    return out
  }

  private async localFileCount(): Promise<number> {
    return (await readdir(this.notesDir).catch(() => [] as string[])).filter(
      (n) => n.endsWith('.md') && !n.endsWith('.tmp'),
    ).length
  }

  /** tombstone 30 天后物理清册。 */
  private async cleanupTombstones(): Promise<void> {
    const manifest = await this.readLocalManifest()
    const now = Date.now()
    let dirty = false
    for (const [id, entry] of Object.entries(manifest.notes)) {
      if (entry.deletedAt && now - entry.deletedAt > TOMBSTONE_TTL_MS) {
        delete manifest.notes[id]
        dirty = true
      }
    }
    if (dirty) await this.writeLocalManifest(manifest)
  }

  private toListItem(note: NoteFile): NoteListItem {
    return {
      id: note.id,
      title: note.title || deriveListTitle(note.markdown),
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      pinned: note.pinned,
      excerpt: noteExcerpt(note.markdown),
      wordCount: noteWordCount(note.markdown),
    }
  }

  private setState(next: SyncState): void {
    this.state = next
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('amoolink:notes:state', next)
    }
  }

  private broadcastChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('amoolink:notes:changed', this.list())
    }
  }

  /** 伴侣 APK 安装(M6-3 构建产物;开发态直接指 apk 输出路径)。 */
  async installPhoneApp(serial: string): Promise<{ ok: boolean; message: string }> {
    const client = await deviceService.getDeviceClient(serial)
    if (!client) return { ok: false, message: '设备已断开' }
    const apkPath = app.isPackaged
      ? join(process.resourcesPath, 'resources', 'android', 'AmooNotes.apk')
      : join(app.getAppPath(), '..', '..', 'apps', 'android-notes', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
    try {
      await client.install(apkPath)
      return { ok: true, message: '笔记 App 已安装到手机' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ── 模块级工具 ──────────────────────────────────────────

function md5(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex')
}

function safeManifest(raw: string): Manifest {
  try {
    const obj = JSON.parse(raw) as Partial<Manifest>
    if (obj && typeof obj === 'object' && obj.notes && typeof obj.notes === 'object') {
      return { version: 1, notes: obj.notes }
    }
  } catch {
    // 损坏 manifest 视为空
  }
  return { version: 1, notes: {} }
}

function conflictStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function deriveListTitle(markdown: string): string {
  const first = markdownToText(markdown).split('\n').find((l) => l.trim() !== '')
  return (first ?? '').trim().slice(0, 40) || '未命名笔记'
}

// 同步 API(仅列表与单文件读取使用)
import { readdirSync, readFileSync } from 'node:fs'

export const noteService = new NoteService()
