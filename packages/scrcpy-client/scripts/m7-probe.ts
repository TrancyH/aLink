/**
 * M7 探针:返回与中键。
 * 断言:
 * 1. 深链进入显示设置 → 生产路径返回(协议 BACK + shell 兜底)→ 前台离开子页 ✓
 * 2. HOME(中键的动作)仍生效 ✓
 * 观察:协议级 BACK 单独是否被 StepOS 过滤(已知该机被拦)
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
  async function fg(): Promise<string> {
    const out = await execOut(client, 'dumpsys activity activities')
    return /[\w.$]+\/[\w.$]+/.exec(/topResumedActivity=[^\n]+/.exec(out)?.[0] ?? '')?.[0] ?? 'unknown'
  }

  const session = new ScrcpySession(client, { bitrate: 2_000_000, stayAwake: true })
  session.on('error', (e) => console.log('  [session]', e.message))
  await session.start()

  // ── 1. 生产路径返回(协议 + shell 兜底,与 MirrorService 一致) ──
  await execOut(client, 'am start -a android.settings.DISPLAY_SETTINGS')
  await sleep(2200)
  const start = await fg()
  if (!/DisplaySettings/i.test(start)) fail(`未进入显示设置(${start})`)
  session.goBack() // 协议(该机被过滤)
  await execOut(client, 'input keyevent 4') // shell 兜底(MirrorService 同款)
  await sleep(1600)
  const back1 = await fg()
  if (/DisplaySettings/i.test(back1)) fail(`返回无效(${back1})`)
  console.log(`✓ 返回生效:${start} → ${back1}`)

  // 观察:仅协议返回(无 shell)是否生效
  await execOut(client, 'am start -a android.settings.DISPLAY_SETTINGS')
  await sleep(2000)
  session.goBack()
  await sleep(1600)
  const protoOnly = await fg()
  console.log(
    `观察:仅协议返回${/DisplaySettings/i.test(protoOnly) ? '被该机过滤(shell 兜底必要)' : '有效'}`,
  )
  if (/DisplaySettings/i.test(protoOnly)) await execOut(client, 'input keyevent 4')

  // ── 2. HOME(中键动作) ──
  session.goHome()
  await sleep(1500)
  const home = await fg()
  if (!/launcher/i.test(home)) fail(`HOME 无效(${home})`)
  console.log(`✓ HOME(中键动作)生效:${home}`)

  session.stop()
  console.log('M7 探针全部通过 ✓')
  process.exit(0)
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
