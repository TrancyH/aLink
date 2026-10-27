import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 用户设置(M1 起持久化到 userData/settings.json)。 */
export interface AppSettings {
  mirror: {
    maxSize: number
    bitrate: number
    maxFps: number
    stayAwake: boolean
    /** 拖拽到投屏窗口的文件在手机上的保存目录。 */
    uploadDir: string
    /** 电脑操控投屏时自动熄灭手机屏幕(物理触屏/断开恢复)。 */
    autoBlackScreen: boolean
    /** 音频转发(手机媒体声音在电脑播放)。 */
    audio: boolean
    /** 视频编码 h264 | h265。 */
    videoCodec: 'h264' | 'h265'
  }
  files: {
    downloadDir: string
  }
  privacy: {
    clipboardSyncMode: 'auto' | 'manual'
    keepHistory: boolean
  }
  notifications: {
    enabled: boolean
  }
  notes: {
    /** 手机连接后自动双向同步笔记(关=仅手动同步)。 */
    autoSync: boolean
  }
  general: {
    language: 'zh-CN'
    autoStart: boolean
    tray: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  mirror: { maxSize: 0, bitrate: 8_000_000, maxFps: 0, stayAwake: true, uploadDir: '/sdcard/Download', autoBlackScreen: true, audio: true, videoCodec: 'h264' },
  files: { downloadDir: '' },
  privacy: { clipboardSyncMode: 'manual', keepHistory: false },
  notifications: { enabled: true },
  notes: { autoSync: true },
  general: { language: 'zh-CN', autoStart: false, tray: true },
}

class SettingsStore {
  private cache: AppSettings | null = null

  private get file(): string {
    return join(app.getPath('userData'), 'settings.json')
  }

  get(): AppSettings {
    if (this.cache) return this.cache
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AppSettings>
        this.cache = deepMerge(structuredClone(DEFAULT_SETTINGS), raw)
      }
    } catch {
      // 损坏的设置文件回退默认值
    }
    this.cache ??= structuredClone(DEFAULT_SETTINGS)
    return this.cache
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = deepMerge(this.get(), patch)
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(this.file, JSON.stringify(next, null, 2), 'utf8')
    this.cache = next
    return next
  }
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch === undefined ? base : (patch as T)
  }
  const out = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const baseValue = out[key]
    out[key] =
      baseValue !== null && typeof baseValue === 'object' && !Array.isArray(baseValue)
        ? deepMerge(baseValue, value)
        : value
  }
  return out as T
}

export const settingsStore = new SettingsStore()
