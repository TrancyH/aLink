/**
 * 通知按 App 免打扰真机探针:
 * 1. cmd notification post 发一条测试通知 → dumpsys 解析命中(非噪声)
 * 2. applyMuted(['com.android.shell']) → 该通知被过滤;其他 pkg 保留
 * 3. m3 解析链路回归(解析 → isNoise → diff)
 * 注:Android 16 shell 无法 cancel 测试通知,残留无害(T46 已知)。
 */
import { AdbTransport, execOut, parseNotifications, diffNewNotifications, isNoise, applyMuted, type NotificationItem } from '../src/index.js'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handle = (await transport.listDevices()).find((h) => h.state === 'device')
  if (!handle || !handle.client) fail('无授权设备')
  const client = handle.client
  console.log(`设备: ${handle.serial}`)

  // ── 1. 发测试通知并解析 ──
  const marker = `AmooMute${Date.now().toString(36)}`
  await execOut(client, `cmd notification post -S bigtext -t '免打扰探针' ${marker} '静音过滤验证用通知'`)
  await sleep(800)
  let hit: NotificationItem | undefined
  for (let i = 0; i < 5 && !hit; i++) {
    const dump = await execOut(client, 'dumpsys notification --noredact')
    hit = parseNotifications(dump).find((n) => !isNoise(n) && n.key.includes(marker))
    if (!hit) await sleep(700)
  }
  if (!hit) fail('dumpsys 未解析到测试通知(m3 解析层回归失败)')
  console.log(`✓ 解析命中:key=${hit.key.slice(0, 40)}… pkg=${hit.pkg}`)

  // ── 2. 静音过滤 ──
  const items = [hit, { pkg: 'com.other.app', key: 'other|k', importance: 'HIGH', title: 't', text: 'b', whenMs: Date.now() }]
  const kept = applyMuted(items, [hit.pkg])
  if (kept.some((n) => n.pkg === hit.pkg)) fail('静音 pkg 未被过滤')
  if (kept.length !== 1 || kept[0]?.pkg !== 'com.other.app') fail('非静音 pkg 被误过滤')
  console.log('✓ 静音过滤:目标 pkg 被滤除,其他 pkg 保留')

  // ── 3. diff 层不重放语义(静音期到达、取消静音后不重放)──
  const fresh1 = applyMuted(diffNewNotifications([], items), [hit.pkg])
  if (fresh1.some((n) => n.pkg === hit.pkg)) fail('静音期 diff 结果仍含目标 pkg')
  const fresh2 = applyMuted(diffNewNotifications(items, items), [])
  if (fresh2.length !== 0) fail('取消静音后重放了静音期历史')
  console.log('✓ 不重放语义:静音期历史在取消静音后不会弹出')

  console.log('通知免打扰探针全部通过 ✓')
  process.exit(0)
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
