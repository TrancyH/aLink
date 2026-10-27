/**
 * 真机冒烟测试(M0 验收):轮询 DeviceManager 数轮,输出设备档案。
 * 通过标准:至少一台设备 state === 'device' 且能取到 model / androidVersion / battery。
 *
 * 运行:pnpm check:device(根目录)或 pnpm -F @amoolink/adb exec tsx scripts/check-device.ts
 * 注:脚本放在 @amoolink/adb(ESM 包)内执行,避免 @u4/adbkit 纯 ESM 导出在 CJS 上下文不可解析。
 */
import { DeviceManager, type DeviceInfo } from '../src/index.js'

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '?'
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / 1024 ** 2).toFixed(0)}MB`
}

function printDevices(devices: DeviceInfo[]): void {
  console.log(`检测到 ${devices.length} 台设备:`)
  for (const d of devices) {
    console.log('─'.repeat(60))
    console.log(`  序列号: ${d.serial}`)
    console.log(`  状态:   ${d.state}(${d.connection})`)
    if (d.state === 'device') {
      console.log(`  型号:   ${d.brand ?? ''} ${d.model ?? '?'}`)
      console.log(`  系统:   Android ${d.androidVersion ?? '?'}(SDK ${d.sdkInt ?? '?'}, ${d.abi ?? '?'})`)
      console.log(`  屏幕:   ${d.screen ? `${d.screen.width}×${d.screen.height}@${d.screen.density}dpi` : '?'}`)
      console.log(`  电量:   ${d.battery ? `${d.battery.level}%${d.battery.charging ? '(充电中)' : ''}` : '?'}`)
      console.log(`  存储:   ${d.storage ? `共 ${formatBytes(d.storage.totalBytes)},剩余 ${formatBytes(d.storage.freeBytes)}` : '?'}`)
    }
  }
  console.log('─'.repeat(60))
}

async function main(): Promise<void> {
  const manager = new DeviceManager(1500)
  let latest: DeviceInfo[] = []
  manager.on('update', (devices: DeviceInfo[]) => {
    latest = devices
    printDevices(devices)
  })
  manager.on('error', (err: unknown) => {
    console.error('adb 连接错误:', err instanceof Error ? err.message : err)
  })

  await manager.start()
  // 覆盖两个轮询周期,验证拔插/变化路径后退出
  await new Promise((resolve) => setTimeout(resolve, 3600))
  manager.stop()

  const usable = latest.filter((d) => d.state === 'device')
  if (usable.length === 0) {
    console.error('冒烟测试失败:没有处于 device 状态的设备')
    process.exitCode = 1
    return
  }
  const first = usable[0]
  if (!first.model || !first.androidVersion || !first.battery) {
    console.error('冒烟测试失败:设备档案不完整(model/androidVersion/battery 缺失)', first)
    process.exitCode = 1
    return
  }
  console.log(`冒烟测试通过 ✓ (${first.model}, Android ${first.androidVersion}, 电量 ${first.battery.level}%)`)
}

void main().catch((err: unknown) => {
  console.error('冒烟测试异常:', err)
  process.exitCode = 1
})
