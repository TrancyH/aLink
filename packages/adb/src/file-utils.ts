/** 远端(设备)路径与 shell 工具(M2 文件互传)。 */

/** 拼接远端路径,压缩重复斜杠并去尾部斜杠。 */
export function joinRemote(dir: string, name: string): string {
  const base = dir.replace(/\/+/g, '/').replace(/\/+$/, '')
  return `${base}/${name}`
}

/** shell 单引号转义(rm/md5sum 等命令拼接用)。 */
export function escapeShell(path: string): string {
  return path.replace(/'/g, "'\\''")
}

/** 字节数人性化(传输 UI/日志)。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes}B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}${units[unit]}`
}

/** adbkit Sync Entry → UI 文件条目(纯映射,便于单测)。 */
export interface RawEntryLike {
  name: string
  size: number | bigint
  /** adbkit 声明为 Date,构造签名却是 number —— 两种形态都兼容。 */
  mtime: Date | number | bigint
  isDirectory(): boolean
}

export interface FileEntry {
  name: string
  isDir: boolean
  size: number
  mtimeMs: number
}

function toMs(mtime: Date | number | bigint): number {
  if (mtime instanceof Date) return mtime.getTime()
  return Number(mtime) * 1000
}

export function toFileEntries(entries: RawEntryLike[]): FileEntry[] {
  return entries
    .map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      size: Number(e.size),
      mtimeMs: toMs(e.mtime),
    }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}
