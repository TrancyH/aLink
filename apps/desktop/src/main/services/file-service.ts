import type { DeviceClient } from '@amoolink/adb'
import { execOut, joinRemote, escapeShell, toFileEntries, type FileEntry } from '@amoolink/adb'

export type { FileEntry }
export { joinRemote }

/** 快捷目录(Files 页顶栏)。 */
export const QUICK_DIRS: Array<{ label: string; path: string }> = [
  { label: '内部存储', path: '/sdcard' },
  { label: '下载', path: '/sdcard/Download' },
  { label: '相册', path: '/sdcard/DCIM' },
  { label: '图片', path: '/sdcard/Pictures' },
  { label: '视频', path: '/sdcard/Movies' },
  { label: '音乐', path: '/sdcard/Music' },
]

/** 列出设备目录;目录不存在时返回空列表。 */
export async function listDir(client: DeviceClient, path: string): Promise<FileEntry[]> {
  const sync = await client.syncService()
  try {
    const entries = await sync.readdir(path)
    return toFileEntries(entries)
  } catch (err) {
    // ENOENT 等按空目录处理(StepX 的 /sdcard 子目录可能不存在)
    if (err instanceof Error && /ENOENT|No such/.test(err.message)) return []
    throw err
  } finally {
    sync.end()
  }
}

/** 删除设备文件/空目录;返回是否成功。 */
export async function deletePath(client: DeviceClient, path: string): Promise<boolean> {
  await execOut(client, `rm -rf '${escapeShell(path)}'`)
  return true
}
