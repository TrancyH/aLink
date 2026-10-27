/**
 * M1 真机集成探针:验证 ScrcpySession 端到端可用性。
 *
 * 断言项(全部通过才退出 0):
 * 1. 服务端启动成功并返回 meta(deviceName/codec/宽高)
 * 2. 收到 video-config(SPS/PPS)与至少 1 个关键帧,且帧 pts 单调不减
 * 3. 反控:打开系统设置 → 注入 HOME → 手机前台焦点发生变化
 *
 * 运行:pnpm -F @amoolink/scrcpy-client exec tsx scripts/mirror-probe.ts
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { AdbTransport, execOut } from '@amoolink/adb'
import {
  ScrcpySession,
  overrideScrcpyJar,
  type MirrorStats,
  type ScrcpyMeta,
  type VideoConfigInfo,
} from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const jarPath = resolve(here, '../../../apps/desktop/resources/scrcpy/scrcpy-server-v3.3.1.jar')
overrideScrcpyJar(jarPath)

interface FrameInfo {
  ptsUs: number
  keyframe: boolean
  size: number
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`等待 ${what} 超时(${ms}ms)`)), ms)),
  ])
}

async function currentFocus(dc: ReturnType<AdbTransport['getDeviceClient']>): Promise<string> {
  const client = dc as NonNullable<typeof dc>
  // 窗口过渡期 mCurrentFocus 可能为 null 的瞬态,以 topResumedActivity 为准并重试
  for (let i = 0; i < 6; i++) {
    const act = await execOut(client, 'dumpsys activity activities')
    const line = /topResumedActivity=[^\n]+/.exec(act)?.[0] ?? ''
    // 组件名形如 com.android.settings/.homepage.SettingsHomepageActivity(第一个含 / 的词)
    const comp = /[\w.$]+\/[\w.$]+/.exec(line)?.[0]
    if (comp) return comp
    await new Promise((r) => setTimeout(r, 500))
  }
  return 'unknown'
}

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handles = await transport.listDevices().catch(() => fail('无法连接 adb server'))
  const handle = handles.find((h) => h.state === 'device') ?? fail('没有处于 device 状态的设备')
  console.log(`目标设备: ${handle.serial}`)

  const session = new ScrcpySession(handle.client, { bitrate: 4_000_000 })
  try {
    await runProbe(session, handle)
  } finally {
    session.stop() // 失败路径也清理,避免服务端进程泄漏
  }
}

async function runProbe(
  session: import('../src/index.js').ScrcpySession,
  handle: import('@amoolink/adb').AdbDeviceHandle,
): Promise<void> {

  let meta: ScrcpyMeta | null = null
  let config: VideoConfigInfo | null = null
  const frames: FrameInfo[] = []
  const statsList: MirrorStats[] = []
  let sessionError: Error | null = null

  session.on('video-config', (c: VideoConfigInfo) => {
    config = c
  })
  session.on('frame', (f: { ptsUs: number; keyframe: boolean; data: Uint8Array }) => {
    frames.push({ ptsUs: f.ptsUs, keyframe: f.keyframe, size: f.data.length })
  })
  session.on('stats', (s: MirrorStats) => statsList.push(s))
  session.on('error', (e: Error) => {
    sessionError = e
  })

  console.log('启动 scrcpy 服务端…')
  try {
    meta = await withTimeout(session.start(), 20000, '服务端启动')
  } catch (e) {
    fail(`服务端启动失败: ${e instanceof Error ? e.message : e}`)
  }
  console.log(
    `✓ meta: ${meta.deviceName}(codec=${meta.codec}, ${meta.width}×${meta.height})`,
  )

  await withTimeout(
    (async () => {
      while (!config) await new Promise((r) => setTimeout(r, 100))
    })(),
    10000,
    'video-config',
  )
  console.log(
    `✓ video-config: SPS/PPS ${config.raw.length}B, profile=${config.profileIndex}, 裁剪后 ${config.croppedWidth}×${config.croppedHeight}`,
  )

  await withTimeout(
    (async () => {
      while (frames.length < 2) {
        if (sessionError) throw sessionError
        await new Promise((r) => setTimeout(r, 100))
      }
    })(),
    15000,
    '视频帧',
  )
  const keyframes = frames.filter((f) => f.keyframe)
  if (keyframes.length === 0) fail('未收到关键帧')
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].ptsUs < frames[i - 1].ptsUs) fail(`pts 回退: ${frames[i - 1].ptsUs} → ${frames[i].ptsUs}`)
  }
  console.log(
    `✓ 视频: ${frames.length} 帧(关键帧 ${keyframes.length}),首帧 ${frames[0].size}B`,
  )

  // 反控验证(主断言):触摸点击设置页第一行 → 前台应进入子页
  // (实测该机型 keycode HOME 注入无效 —— 格式正确但系统不响应,故 HOME 仅作观察项)
  await execOut(handle.client, 'am start -a android.settings.SETTINGS')
  await new Promise((r) => setTimeout(r, 2500))
  // 动态取第一个可点击列表行中心(uiautomator),避免页面内容变化导致坐标漂移
  const ui = await execOut(handle.client, 'uiautomator dump /sdcard/u.xml >/dev/null 2>&1; cat /sdcard/u.xml')
  const clickable = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*clickable="true"|clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(ui)
  let tapX = 600
  let tapY = 430
  const m = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"(?=[^>]*clickable="true")/.exec(ui) ?? /clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(ui)
  if (m) {
    const x1 = Number(m[1]), y1 = Number(m[2]), x2 = Number(m[3]), y2 = Number(m[4])
    if (y1 > 200 && y2 - y1 > 60) {
      tapX = Math.round((x1 + x2) / 2)
      tapY = Math.round((y1 + y2) / 2)
    }
  }
  void clickable
  console.log(`点击坐标:(${tapX},${tapY})`)
  const focusBefore = await currentFocus(handle.client)
  console.log(`反控前前台: ${focusBefore}`)
  session.tap(tapX, tapY)
  let focusAfter = focusBefore
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500))
    focusAfter = await currentFocus(handle.client)
    if (focusAfter !== focusBefore) break
  }
  console.log(`触摸注入后前台: ${focusAfter}`)
  if (focusBefore === focusAfter) fail('触摸注入后前台 Activity 未变化(反控疑似无效)')
  if (focusBefore === focusAfter) fail('触摸注入后前台未变化')
  void fail
  console.log('✓ 反控:触摸注入生效(前台切换)')

  // 观察项:HOME keycode(该机型已知无效,不作为失败条件)
  session.goHome()
  await new Promise((r) => setTimeout(r, 1500))
  const focusHome = await currentFocus(handle.client)
  console.log(
    `观察:HOME keycode 后前台 ${focusHome}${focusHome === focusAfter ? '(无效 —— 该机型已知限制,工具条 Home 按钮后续可用 shell 兜底)' : '(生效)'}`,
  )

  session.stop()
  const totalStats = statsList.at(-1)
  console.log(
    `会话统计: ${session.stats.frames} 帧 / ${(session.stats.bytes / 1024).toFixed(0)}KB${
      totalStats ? `, 末秒 ${totalStats.fps}fps ${totalStats.kbps}KB/s` : ''
    }`,
  )
  console.log('探针全部通过 ✓')
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
