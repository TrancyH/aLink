/**
 * M8 探针:无线连接经典模式(tcpip 5555)+ 应用面板。
 * 断言:
 * 1. enableTcpip + connect → adb devices 出现 ip:5555 且 state=device
 * 2. 无线通道 shell 可用(getprop)
 * 3. pm list packages -3 返回非空;monkey 启动设置 App 后前台变化
 * 结束:断开无线(保留 USB)
 */
import { AdbTransport, execOut, connectWireless } from '../src/index.js'
import { execFileSync } from 'node:child_process'


function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handle = (await transport.listDevices()).find((h) => h.state === 'device') ?? fail('无 USB 设备')
  const client = handle.client
  console.log(`USB 设备: ${handle.serial}`)

  // ── 1. tcpip + 无线连接 ──
  const ip = /inet (\d+\.\d+\.\d+\.\d+)/.exec(await execOut(client, 'ip addr show wlan0'))?.[1]
  if (!ip) fail('手机未连 Wi-Fi')
  execFileSync('adb', ['-s', handle.serial, 'tcpip', '5555'], { encoding: 'utf8' })
  console.log(`tcpip 已开,等待 ${ip}:5555 …`)
  let connected = false
  for (let i = 0; i < 15; i++) {
    await sleep(1000)
    const out = await connectWireless(ip, 5555).catch(() => '')
    if (/connected to/i.test(out)) {
      connected = true
      break
    }
  }
  if (!connected) fail('无线连接超时')
  await sleep(1500)
  const devices = execFileSync('adb', ['devices'], { encoding: 'utf8' })
  const wifiLine = devices.split('\n').find((l) => l.startsWith(`${ip}:5555`))
  if (!wifiLine || !/device$/.test(wifiLine.trim())) fail(`devices 无线条目异常:${wifiLine ?? '无'}`)
  console.log(`✓ 无线连接:${wifiLine.trim()}`)

  // ── 2. 无线通道 shell ──
  const t2 = new AdbTransport()
  const wifiHandle = (await t2.listDevices()).find((h) => h.serial === `${ip}:5555` && h.state === 'device')
  if (!wifiHandle) fail('无线 transport 不可见')
  const model = await execOut(wifiHandle.client, 'getprop ro.product.model')
  if (!model.trim()) fail('无线 shell 无输出')
  console.log(`✓ 无线 shell:getprop model=${model.trim()}`)

  // ── 3. 应用面板通路 ──
  const pkgs = (await execOut(wifiHandle.client, 'pm list packages -3'))
    .split('\n')
    .filter((l) => l.startsWith('package:'))
  if (pkgs.length === 0) fail('第三方应用列表为空')
  console.log(`✓ 应用列表:${pkgs.length} 个第三方应用`)

  // 启动设置(monkey launcher)
  await execOut(wifiHandle.client, 'monkey -p com.android.settings -c android.intent.category.LAUNCHER 1')
  await sleep(2200)
  const act = await execOut(wifiHandle.client, 'dumpsys activity activities')
  // 无线通道 dumpsys 偶发丢前缀(topResumed → Resumed),宽松匹配
  const top =
    /[\w.$]+\/[\w.$]+/.exec(/topResumedActivity=[^\n]+/.exec(act)?.[0] ?? '')?.[0] ??
    /[\w.$]+\/[\w.$]+/.exec(/ResumedActivity[^\n]*/.exec(act)?.[0] ?? '')?.[0] ??
    ''
  if (!/settings/i.test(top)) fail(`启动设置失败(top=${top})`)
  console.log(`✓ 应用启动:${top}`)

  // ── 清理:断开无线(保留 USB)──
  execFileSync('adb', ['disconnect', `${ip}:5555`], { encoding: 'utf8' })
  await sleep(800)
  console.log('✓ 已断开无线(USB 保留)')
  console.log('M8 探针全部通过 ✓')
  process.exit(0)
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
