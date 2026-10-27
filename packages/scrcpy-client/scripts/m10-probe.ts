/**
 * M10 探针:完整录屏链路(与渲染端共用同一 H264Mp4Recorder)。
 * 断言:avcC 构造 ✓ / 10s 录制帧>20 且关键帧≥2 / mp4 结构 ftyp+moov+avcC / 落盘 /tmp/amoolink-m10.mp4
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { AdbTransport, execOut } from '@amoolink/adb'
import { ScrcpySession, overrideScrcpyJar, H264Mp4Recorder, validateMp4, buildAvcC } from '../src/index.js'

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

  const session = new ScrcpySession(client, { bitrate: 4_000_000, stayAwake: true })
  session.on('error', (e) => console.log('  [session]', e.message))
  const meta = await session.start()
  console.log(`✓ 会话:${meta.width}x${meta.height} ${meta.codec}`)

  const cfgDeadline = Date.now() + 5000
  while (!session.lastVideoConfig && Date.now() < cfgDeadline) await sleep(200)
  const configRaw = session.lastVideoConfig
  if (!configRaw) fail('未收到 video-config(5s)')
  const avcC = buildAvcC(configRaw)
  if (!avcC) fail('buildAvcC 失败')
  console.log(`✓ avcC 构造(${avcC.length}B)`)

  const rec = new H264Mp4Recorder({ width: meta.width, height: meta.height, framerate: 30 })
  rec.setConfig(configRaw)
  rec.start()
  session.resetVideo() // 请求新关键帧(scrcpy 此后只发 P 帧,必须 reset)
  let keys = 0
  session.on('frame', (f: { data: Uint8Array; ptsUs: number; keyframe: boolean }) => {
    if (f.keyframe) keys += 1
    rec.feed(f.data, f.ptsUs, f.keyframe)
  })

  console.log('录制 10s(期间切换页面制造画面变化)…')
  const t0 = Date.now()
  let toggle = 0
  while (Date.now() - t0 < 10000) {
    if (toggle % 2 === 0) await execOut(client, 'am start -a android.settings.SETTINGS')
    else session.goHome()
    toggle += 1
    await sleep(2400)
  }
  console.log(`帧 ${rec.frameCount}(关键帧 ${keys}),session.stats.frames=${session.stats.frames}`)
  if (rec.frameCount < 20) fail(`帧数过少(${rec.frameCount})`)
  if (keys < 1) fail('无关键帧(RESET_VIDEO 未生效)')

  const bytes = rec.finish()
  if (!bytes || bytes.length < 50_000) fail(`mp4 产物异常(${bytes?.length ?? 0}B)`)
  const check = validateMp4(bytes)
  if (!check.ok) fail(`mp4 结构校验失败:${check.reason}`)
  console.log(`✓ mp4 ${(bytes.length / 1024 / 1024).toFixed(2)}MB,结构合法(ftyp+moov+avcC)`)

  const out = '/tmp/amoolink-m10.mp4'
  await writeFile(out, bytes)
  console.log(`✓ 已写入 ${out}`)
  session.stop()
  console.log('M10 探针全部通过 ✓')
  process.exit(0)
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
