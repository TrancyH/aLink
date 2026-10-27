import { clipboard, ClipboardItem } from 'electron'
import { execOut, joinRemote } from '@amoolink/adb'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deviceService } from './device-service'
import { mirrorService } from './mirror-service'
import { settingsStore } from '../settings-store'

/**
 * 剪贴板双向同步 + 截图通路(M3)。
 *
 * 文本同步走投屏会话的 scrcpy 控制通道(GET/SET_CLIPBOARD)—— 因此仅在投屏开启时可用;
 * 截图(screencap)与"电脑剪贴板图片→手机相册"走 adb 通道,独立于投屏。
 */
class ClipboardService {
  private autoTimer: ReturnType<typeof setInterval> | null = null
  private autoSerial: string | null = null
  private lastLocalText = ''
  private lastPhoneText = ''

  /** 拉取手机剪贴板(需投屏会话在线)。 */
  async pullFromPhone(serial: string): Promise<string> {
    const session = mirrorService.getSession(serial)
    if (!session) throw new Error('剪贴板同步需要先开启投屏(scrcpy 控制通道)')
    const text = await session.getClipboard()
    this.lastPhoneText = text
    if (text) {
      await clipboard.writeText(text)
      this.lastLocalText = text
    }
    return text
  }

  /** 推送电脑剪贴板文本到手机(需投屏会话在线)。 */
  async pushToPhone(serial: string, text?: string): Promise<void> {
    const session = mirrorService.getSession(serial)
    if (!session) throw new Error('剪贴板同步需要先开启投屏(scrcpy 控制通道)')
    const payload = text ?? (await clipboard.readText())
    if (!payload) throw new Error('电脑剪贴板为空')
    this.lastLocalText = payload
    await session.setClipboard(payload)
    this.lastPhoneText = payload
  }

  /** 自动同步(设置切到 auto 且投屏在线时由 MirrorService 调用)。 */
  startAuto(serial: string): void {
    this.stopAuto()
    this.autoSerial = serial
    this.lastLocalText = ''
    this.lastPhoneText = ''
    this.autoTimer = setInterval(() => {
      void this.autoTick(serial)
    }, 1200)
  }

  stopAuto(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer)
      this.autoTimer = null
    }
    this.autoSerial = null
  }

  private async autoTick(serial: string): Promise<void> {
    const session = mirrorService.getSession(serial)
    if (!session) {
      this.stopAuto()
      return
    }
    try {
      // 电脑 → 手机:本机文本变化且不是刚从手机同步来的
      const local = await clipboard.readText()
      if (local && local !== this.lastLocalText && local !== this.lastPhoneText) {
        await session.setClipboard(local)
        this.lastLocalText = local
        this.lastPhoneText = local
        return
      }
      // 手机 → 电脑:手机文本变化且不是刚推过去的
      const phone = await session.getClipboard(1500)
      if (phone && phone !== this.lastPhoneText && phone !== this.lastLocalText) {
        await clipboard.writeText(phone)
        this.lastLocalText = phone
        this.lastPhoneText = phone
      }
    } catch {
      // 单次轮询失败不中断自动同步(超时/通道瞬断)
    }
  }

  /** 手机截屏 → PNG 字节(exec-out screencap,走 adb,不依赖投屏)。 */
  async capturePhoneScreen(serial: string): Promise<Buffer> {
    const client = await deviceService.getDeviceClient(serial)
    if (!client) throw new Error('设备不可用')
    // 二进制必须走无 encoding 的 execOut(返回 Buffer)
    const png = (await client.execOut('screencap -p')) as Buffer
    if (!Buffer.isBuffer(png) || png.length < 1000 || png[0] !== 0x89 || png[1] !== 0x50) {
      throw new Error(`screencap 输出异常(${png?.length ?? 0}B,非 PNG)`)
    }
    return png
  }

  /** 手机截屏并写入电脑剪贴板(可选存盘)。 */
  async phoneScreenshotToClipboard(serial: string): Promise<string> {
    const png = await this.capturePhoneScreen(serial)
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) }),
    ])
    const dir = settingsStore.get().files.downloadDir
    let saved = ''
    if (dir) {
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `amoolink-shot-${serial}-${Date.now()}.png`)
      writeFileSync(file, png)
      saved = file
    }
    return saved
  }

  /** 电脑剪贴板图片 → 手机相册(/sdcard/Pictures/AmooLink)+ 媒体扫描。 */
  async sendClipboardImageToPhone(serial: string): Promise<string> {
    const items = await clipboard.read()
    const imgItem = items.find((it) => it.types.includes('image/png'))
    if (!imgItem) throw new Error('电脑剪贴板中没有图片')
    const blob = await imgItem.getType('image/png')
    const bytes = Buffer.from(await blob.arrayBuffer())
    const client = await deviceService.getDeviceClient(serial)
    if (!client) throw new Error('设备不可用')

    const remoteDir = '/sdcard/Pictures/AmooLink'
    await execOut(client, `mkdir -p '${remoteDir}'`)
    const name = `clip-${Date.now()}.png`
    const remotePath = joinRemote(remoteDir, name)

    // adbkit push 需要流:落临时文件再推
    const tmpDir = await mkdtemp(join(tmpdir(), 'amoolink-clip-'))
    const tmpFile = join(tmpDir, name)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(tmpFile, bytes)
    try {
      const { createReadStream } = await import('node:fs')
      const transfer = await client.push(createReadStream(tmpFile), remotePath, 0o644)
      await transfer.waitForEnd()
    } finally {
      await rm(tmpDir, { force: true, recursive: true })
    }
    // 媒体扫描让相册立即可见
    await execOut(
      client,
      `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file://${remotePath}'`,
    )
    return remotePath
  }
}

export const clipboardService = new ClipboardService()
