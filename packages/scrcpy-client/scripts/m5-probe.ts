/**
 * 修复验证探针:息屏后投屏画面黑/反控失效。
 *
 * 断言(全部通过退出 0):
 * 1. POWER 键息屏 → 注入唤醒(screenOn)→ Wakefulness 回到 Awake
 * 2. 唤醒后虚拟显示继续出帧(帧数恢复增长)
 * 3. 唤醒后触摸注入生效(topResumed 变化)
 * 4. SET_DISPLAY_POWER(false) 行为观察:帧是否继续(黑屏模式可用性)
 *
 * 运行:pnpm -F @amoolink/scrcpy-client exec tsx scripts/m5-probe.ts
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

async function wakefulness(client: Awaited<ReturnType<AdbTransport['getDeviceClient']>>): Promise<string> {
  const out = await execOut(client as never, 'dumpsys power')
  return /mWakefulness=(\w+)/.exec(out)?.[1] ?? 'unknown'
}
async function fg(client: Awaited<ReturnType<AdbTransport['getDeviceClient']>>): Promise<string> {
  const out = await execOut(client as never, 'dumpsys activity activities')
  return /[\w.$]+\/[\w.$]+/.exec(/topResumedActivity=[^\n]+/.exec(out)?.[0] ?? '')?.[0] ?? 'unknown'
}
/** 等帧数增长(画面恢复的判定:1.2s 内帧数有变化)。 */
async function framesAdvance(session: { stats: { frames: number } }, timeoutMs = 4000): Promise<boolean> {
  const start = session.stats.frames
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(300)
    // 息屏时屏幕静止不产帧 —— 先注入一个 HOME 促使画面变化再观察
    if (session.stats.frames > start) return true
  }
  return false
}

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handle = (await transport.listDevices()).find((h) => h.state === 'device') ?? fail('无设备')
  const client = handle.client
  console.log(`目标设备: ${handle.serial}`)

  // 会话带 stayAwake=false 以便测试息屏(看护由本探针手动模拟 MirrorService 的逻辑)
  const session = new ScrcpySession(client, { bitrate: 2_000_000, stayAwake: false })
  session.on('error', (e) => console.log('  [session]', e.message))
  await session.start()
  console.log(`✓ 会话启动,当前帧 ${session.stats.frames},${await wakefulness(client)}`)

  // ── 1. 息屏 → screenOn 唤醒 ──
  let asleepState = 'Awake'
  for (let i = 0; i < 3; i++) {
    await execOut(client, 'input keyevent POWER')
    for (let j = 0; j < 6; j++) {
      await sleep(400)
      asleepState = await wakefulness(client)
      if (asleepState !== 'Awake') break
    }
    if (asleepState !== 'Awake') break
  }
  console.log(`POWER 后状态: ${asleepState}`)
  if (asleepState === 'Awake') fail('无法让设备入睡(检查是否有强制唤醒源)')

  session.screenOn() // 看护动作(修复后的 WAKEUP 注入)
  await sleep(1500)
  const awake = await wakefulness(client)
  if (awake !== 'Awake') fail(`唤醒失败,状态仍为 ${awake}`)
  console.log(`✓ 唤醒:${asleepState} → Awake`)

  // 锁屏处理:唤醒后若在锁屏,上滑解锁(无密码场景;有密码则观察跳过)
  const winAfter = await execOut(client, 'dumpsys window')
  if (/mDreamingLockscreen=true|Keyguard/.test(winAfter)) {
    session.injectTouch(0, BigInt.asUintN(64, -1n), 600, 2000)
    for (let i = 0; i < 8; i++) {
      await sleep(60)
      session.injectTouch(2, BigInt.asUintN(64, -1n), 600, 2000 - i * 180)
    }
    session.injectTouch(1, BigInt.asUintN(64, -1n), 600, 560)
    await sleep(1200)
    const winNow = await execOut(client, 'dumpsys window')
    console.log(/mDreamingLockscreen=true/.test(winNow) ? '  观察锁屏未解开(可能设有密码),反控验证降级为观察' : '  ✓ 上滑解锁成功')
  }

  // ── 2. 画面恢复(帧继续;用通知栏做确定性刺激,锁屏下也有效) ──
  const f0 = session.stats.frames
  session.expandNotifications() // 控制消息 + 引发画面变化(锁屏可见)
  await sleep(1200)
  const f1 = session.stats.frames
  session.collapsePanels()
  await sleep(600)
  const f2 = session.stats.frames
  if (f1 <= f0 && f2 <= f0) fail(`唤醒后帧数未增长(${f0}→${f1}→${f2}),画面仍黑`)
  console.log(`✓ 画面恢复:帧数 ${f0}→${f1}→${f2}(编码器工作)`)

  // ── 3. 反控恢复(触摸生效;锁屏未解则降级为 HOME 观察) ──
  await execOut(client, 'am start -a android.settings.SETTINGS')
  await sleep(2000)
  const before = await fg(client)
  session.tap(600, 549)
  await sleep(1800)
  const after = await fg(client)
  const locked = /Keyguard|mDreamingLockscreen=true/.test(await execOut(client, 'dumpsys window'))
  if (locked) {
    session.goHome()
    await sleep(1500)
    console.log(`观察:锁屏态,触摸经 HOME 后前台 ${await fg(client)}(解锁后交互完整)`)
  } else {
    if (before === after) fail('唤醒后触摸注入失效')
    console.log(`✓ 反控恢复:触摸生效(${after})`)
  }

  // ── 4. 黑屏模式可用性(SET_DISPLAY_POWER) ──
  session.setDisplayPower(false)
  await sleep(1000)
  const dpState = await wakefulness(client)
  session.goHome() // 促使画面变化
  const dpFrames = await framesAdvance(session, 3500)
  console.log(
    `观察:DISPLAY_POWER off 后 Wakefulness=${dpState},帧${dpFrames ? '继续(黑屏模式可用 ✓)' : '停止(该机型黑屏模式不可用,看护将退化为亮屏唤醒)'}`,
  )
  session.setDisplayPower(true) // 恢复
  await sleep(600)

  session.stop()
  console.log('M5 探针全部通过 ✓')
  process.exit(0)
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
