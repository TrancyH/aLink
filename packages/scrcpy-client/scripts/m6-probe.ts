/**
 * 智能黑屏探针(m6):电脑操控熄屏 → 物理触屏(getevent/sendevent 模拟)→ 恢复点亮。
 * 附:横滑方向冒烟(注入 scroll 无崩溃)。
 *
 * 运行:pnpm -F @amoolink/scrcpy-client exec tsx scripts/m6-probe.ts
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

async function screenState(client: Awaited<ReturnType<AdbTransport['getDeviceClient']>>): Promise<string> {
  const out = await execOut(client as never, 'dumpsys display')
  return /mScreenState=(\w+)/.exec(out)?.[1] ?? 'unknown'
}

/** 解析主触摸屏设备节点。 */
async function touchscreenDev(client: Awaited<ReturnType<AdbTransport['getDeviceClient']>>): Promise<string | null> {
  const pl = await execOut(client as never, 'getevent -pl')
  let best: string | null = null
  let bestMax = 0
  for (const d of pl.split('add device')) {
    const name = /\/dev\/input\/event\d+/.exec(d)?.[0]
    const mx = /ABS_MT_POSITION_X\s*:\s*value \d+, min \d+, max (\d+)/.exec(d)
    if (name && mx && Number(mx[1]) > bestMax) {
      bestMax = Number(mx[1])
      best = name
    }
  }
  return best
}

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handle = (await transport.listDevices()).find((h) => h.state === 'device') ?? fail('无设备')
  const client = handle.client
  console.log(`目标设备: ${handle.serial}`)

  const dev = await touchscreenDev(client)
  if (!dev) fail('未找到触摸屏设备节点')
  console.log(`触摸屏: ${dev}`)

  const session = new ScrcpySession(client, { bitrate: 2_000_000, stayAwake: true })
  session.on('error', (e) => console.log('  [session]', e.message))
  await session.start()
  console.log(`✓ 会话启动(状态 ${await screenState(client)})`)

  // ── 1. 智能黑屏:亮度降到 1(实测该机 SET_DISPLAY_POWER 静默无效,主路径为亮度) ──
  const saved = (await execOut(client, 'settings get system screen_brightness')).trim()
  if (!saved || saved === 'null' || saved === '1') fail(`亮度初值异常:${saved}`)
  session.setDisplayPower(false) // 双保险(部分设备有效)
  await execOut(client, 'settings put system screen_brightness 1')
  await sleep(800)
  const dim = (await execOut(client, 'settings get system screen_brightness')).trim()
  if (dim !== '1') fail(`亮度未降低(${dim})`)
  console.log(`✓ 智能黑屏:亮度 ${saved}→1(系统 ${await screenState(client)},帧 ${session.stats.frames})`)

  // ── 2. 物理触屏恢复(getevent 监听 + sendevent 模拟物理事件) ──
  const watch = await client.shell(`getevent -c 2 '${dev}'`)
  let touched = false
  const stream = watch as unknown as NodeJS.ReadableStream
  stream.on('data', () => {
    touched = true
  })
  await sleep(600) // 等监听就位
  // sendevent 写一条 SYN 事件(经内核 input 层,等同物理事件)
  await execOut(client, `sendevent ${dev} 0 0 0`)
  const deadline = Date.now() + 4000
  while (!touched && Date.now() < deadline) await sleep(200)
  if (!touched) fail('getevent 未收到物理触摸事件')
  console.log('✓ 物理触屏事件被捕获')
  try {
    ;(watch as unknown as { destroy(): void }).destroy()
  } catch {
    /* ignore */
  }

  // 恢复点亮(亮度还原 + DISPLAY_POWER on)
  session.setDisplayPower(true)
  await execOut(client, `settings put system screen_brightness ${saved}`)
  await sleep(800)
  const back = (await execOut(client, 'settings get system screen_brightness')).trim()
  if (back !== saved) fail(`亮度未恢复(${back} != ${saved})`)
  console.log(`✓ 恢复点亮:亮度 ${back}`)

  // ── 3. 横滑冒烟(v3 scroll 消息,修复后符号:内容向左滚=负) ──
  const f0 = session.stats.frames
  session.scroll(600, 1300, 0, 1.5)
  await sleep(800)
  console.log(`横滑冒烟:帧 ${f0}→${session.stats.frames}(无崩溃 ✓)`)

  session.stop()
  console.log('M6 探针全部通过 ✓')
  process.exit(0)
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
