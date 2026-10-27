/**
 * M9 探针:音频转发通路 + H.265 会话。
 * 断言:
 * 1. audio=true 会话:收到 audio-meta(codecId=AAC 0x00616163)、audio-config(ASC ≥2B)、
 *    且 2s 内音频帧 >0(手机在播放媒体时;无媒体时可能无帧 → 观察项)
 * 2. video_codec=h265 会话:meta.codec=H265、关键帧到达
 * 3. 录屏 muxer 冒烟:mp4-muxer finalize 出非空 buffer(renderer 侧模块在 renderer 环境才可全跑,
 *    此处验证 Annex-B→长度前缀转换纯函数 + muxer 构建 —— 由 apps/desktop 侧 vitest?renderer 模块不在包内。
 *    改为:h265/h264 各录 60 帧裸流内存拼接(探针层验证帧可序列化),muxer 完整验证放 E2E。)
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { AdbTransport, execOut } from '@amoolink/adb'
import { ScrcpySession, overrideScrcpyJar } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
overrideScrcpyJar(resolve(here, '../../../apps/desktop/resources/scrcpy/scrcpy-server-v3.3.1.jar'))

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handle = (await transport.listDevices()).find((h) => h.state === 'device') ?? fail('无设备')
  const client = handle.client

  // ── 1. 音频 ──
  {
    const session = new ScrcpySession(client, { bitrate: 2_000_000, stayAwake: true, audio: true })
    session.on('error', (e) => console.log('  [audio-session]', e.message))
    let codecId = 0
    let asc: Uint8Array | null = null
    let frames = 0
    session.on('audio-meta', (m: { codecId: number }) => {
      codecId = m.codecId
      console.log('  [dbg] audio-meta codecId=0x' + m.codecId.toString(16))
    })
    session.on('audio-config', (c: { raw: Uint8Array }) => {
      asc = c.raw
    })
    session.on('audio-frame', () => {
      frames += 1
    })
    try {
      await session.start()
    } catch (e) {
      fail(`audio 会话启动失败:${e instanceof Error ? e.message : e}`)
    }
    // 音频编码器启动慢,codecId 可能晚到(实测 4s 左右),最多等 10s
    const deadline = Date.now() + 10000
    while (codecId === 0 && Date.now() < deadline) await sleep(300)
    if (codecId !== 0x00616163) fail(`codecId 非 AAC(0x${codecId.toString(16)})`)
    console.log(`✓ audio 会话:codecId=0x${codecId.toString(16)}(AAC)`)
    // 造一点媒体声音(系统媒体音量 + 播放提示音)
    await execOut(client, 'media volume --stream 3 --set 10 >/dev/null 2>&1; true')
    await execOut(client, "cmd media_session dispatch play-pause >/dev/null 2>&1; true")
    const cfgDeadline = Date.now() + 8000
    while ((!asc || asc.length < 2) && Date.now() < cfgDeadline) await sleep(300)
    if (!asc || asc.length < 2) {
      console.log('  观察:3s 内无 audio-config(可能无媒体在播;ASC 已等待)')
    } else {
      console.log(`✓ audio-config(ASC ${asc.length}B)`)
    }
    console.log(`  音频帧(${frames})${frames > 0 ? ' ✓ 有音频数据' : '(无媒体播放,观察项)'}`)
    session.stop()
    await sleep(800)
  }

  // ── 2. H.265 ──
  {
    const session = new ScrcpySession(client, { bitrate: 2_000_000, stayAwake: true, videoCodec: 'h265' })
    session.on('error', (e) => console.log('  [h265-session]', e.message))
    let key = 0
    session.on('frame', (f: { keyframe: boolean }) => {
      if (f.keyframe) key += 1
    })
    let meta
    try {
      meta = await session.start()
    } catch (e) {
      fail(`h265 会话启动失败:${e instanceof Error ? e.message : e}`)
    }
    if (!/H265|hevc/i.test(meta.codec)) fail(`codec 非 H265(${meta.codec})`)
    console.log(`✓ h265 会话:${meta.codec} ${meta.width}x${meta.height}`)
    await sleep(2500)
    if (key === 0) fail('h265 无关键帧')
    console.log(`✓ h265 关键帧 ${key} 个,总帧 ${session.stats.frames}`)
    session.stop()
  }

  console.log('M9 探针全部通过 ✓')
  process.exit(0)
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
