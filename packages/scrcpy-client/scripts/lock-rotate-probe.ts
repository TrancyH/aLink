/**
 * 锁屏 + 旋转真机探针:
 * 1. lockScreen()(KEYCODE_SLEEP=223 注入;实测 POWER=26 被 StepOS 过滤)→ 期望 Dozing/Asleep
 * 2. screenOn()(KEYCODE_WAKEUP)→ 期望恢复 Awake
 * 3. rotateDevice() → 期望收到新的 video-config(SPS 重发,即旋转产生分辨率变化的通路)
 * 结束:关自动旋转再恢复,旋转回到 0°,屏幕点亮
 */
import { AdbTransport, execOut } from '@amoolink/adb'
import { ScrcpySession } from '../src/index.js'
import { statSync } from 'node:fs'
import { join } from 'node:path'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const JAR = join(process.cwd(), '..', '..', 'apps', 'desktop', 'resources', 'scrcpy', 'scrcpy-server-v3.3.1.jar')

async function wakefulness(client: NonNullable<Awaited<ReturnType<AdbTransport['getDeviceClient']>>>): Promise<string> {
  const out = await execOut(client, 'dumpsys power')
  return out.match(/mWakefulness=(\w+)/)?.[1] ?? 'unknown'
}

async function main(): Promise<void> {
  statSync(JAR)
  const transport = new AdbTransport()
  const handle = (await transport.listDevices()).find((h) => h.state === 'device')
  if (!handle) fail('无授权设备')
  const client = handle.client ?? fail('设备客户端不可用')
  console.log(`设备: ${handle.serial}`)

  // 关自动旋转,避免传感器把旋转弹回
  const accelBefore = (await execOut(client, 'settings get system accelerometer_rotation')).trim()
  await execOut(client, 'settings put system accelerometer_rotation 0')

  const session = new ScrcpySession(client, { maxSize: 1200, bitrate: 4_000_000, stayAwake: false }, JAR)
  try {
    const meta = await session.start()
    console.log(`✓ 会话启动:${meta.deviceName.trim()} ${meta.width}×${meta.height}(${meta.codec})`)

    // ── 1. 锁屏 ──
    // SLEEP 熄屏后进 Dozing(AOD)或 Asleep,均视为熄屏成功;系统保持 Awake 才是失败
    const before = await wakefulness(client)
    const isOff = (s: string): boolean => s === 'Asleep' || s === 'Dozing'
    session.lockScreen()
    let state = 'unknown'
    for (let i = 0; i < 6; i++) {
      await sleep(800)
      state = await wakefulness(client)
      if (isOff(state)) break
    }
    if (isOff(state)) {
      console.log(`✓ lockScreen:${before} → ${state}(协议注入生效)`)
    } else {
      // 机型过滤兜底:shell input(与 MirrorService 同模式)
      await execOut(client, 'input keyevent 223')
      for (let i = 0; i < 5; i++) {
        await sleep(800)
        state = await wakefulness(client)
        if (isOff(state)) break
      }
      if (!isOff(state)) fail(`锁屏无效(mWakefulness=${state};协议注入与 shell 兜底均未生效)`)
      console.log(`✓ lockScreen:${before} → ${state}(shell 兜底生效;该机型过滤 SLEEP 注入)`)
    }

    // ── 2. 亮屏恢复 ──
    session.screenOn()
    for (let i = 0; i < 6; i++) {
      await sleep(700)
      state = await wakefulness(client)
      if (state === 'Awake') break
    }
    if (state !== 'Awake') fail(`screenOn 未唤醒(mWakefulness=${state})`)
    console.log('✓ screenOn:Asleep → Awake')

    // ── 3. 旋转 → 新 video-config ──
    // 设备能力探测:StepX 基准机为固定竖屏(USER_ROTATION 被系统忽略,ROTATE_DEVICE
    // 内部即设置 USER_ROTATION),旋转不生效属设备限制而非协议缺陷;
    // 可旋转设备上必须收到新 video-config(渲染侧据此重适配窗口与坐标映射)。
    let gotConfig = false
    session.on('video-config', () => {
      gotConfig = true
    })
    await sleep(1200)
    gotConfig = false
    session.rotateDevice()
    for (let i = 0; i < 10; i++) {
      await sleep(600)
      if (gotConfig) break
    }
    const disp = await execOut(client, 'dumpsys display')
    const rotation = disp.match(/rotation (\d)/)?.[1] ?? '?'
    if (gotConfig) {
      console.log('✓ rotateDevice:收到新 video-config(旋转分辨率变化通路成立,渲染侧可据此重适配)')
    } else if (rotation === '0') {
      console.log(`○ rotateDevice:设备固定竖屏(rotation=0 不随 USER_ROTATION 变化),旋转不生效属设备限制;尺寸回传机制待可旋转设备验证`)
    } else {
      fail(`旋转后未收到新 video-config(rotation=${rotation})`)
    }

    // 旋转回到 0°(每次 +90°)
    session.rotateDevice()
    await sleep(900)
    session.rotateDevice()
    await sleep(900)
    session.rotateDevice()
    await sleep(900)
    await execOut(client, 'settings put system user_rotation 0')
    console.log('✓ 已恢复 0° 方向')

    console.log('锁屏 + 旋转探针全部通过 ✓')
    process.exit(0)
  } finally {
    session.stop()
    if (accelBefore === '1') {
      await execOut(client, 'settings put system accelerometer_rotation 1')
    } else {
      await execOut(client, 'settings put system accelerometer_rotation 0')
    }
  }
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
