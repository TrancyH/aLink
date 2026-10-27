import { describe, expect, it } from 'vitest'
import type { DeviceClientLike } from '../src/adb-transport.js'
import {
  parseGetprop,
  parseSize,
  detectConnection,
  readScreen,
  readBattery,
  readStorage,
} from '../src/device-info.js'

/** 构造 mock 设备客户端:按命令返回真机实测样本。 */
function mockClient(samples: Record<string, string>): DeviceClientLike {
  return {
    execOut: async (cmd: string) => samples[cmd] ?? '',
  } as unknown as DeviceClientLike
}

/** 样本取自真机 StepX PZ261A(Android 16)实测输出。 */
const GETPROP_SAMPLE = `
[ro.product.model]: [PZ261A]
[ro.product.brand]: [StepX]
[ro.product.device]: [pandora]
[ro.build.version.release]: [16]
[ro.build.version.sdk]: [36]
[ro.product.cpu.abilist]: [arm64-v8a]
`.trim()

describe('parseGetprop', () => {
  it('解析 [key]: [value] 行', () => {
    const props = parseGetprop(GETPROP_SAMPLE)
    expect(props['ro.product.model']).toBe('PZ261A')
    expect(props['ro.build.version.sdk']).toBe('36')
    expect(Object.keys(props)).toHaveLength(6)
  })
})

describe('parseSize', () => {
  it('人类可读单位换算(1024 进制)', () => {
    expect(parseSize('117G')).toBe(117 * 1024 ** 3)
    expect(parseSize('512M')).toBe(512 * 1024 ** 2)
    expect(parseSize('1024K')).toBe(1024 * 1024)
    expect(parseSize('1.5T')).toBe(1.5 * 1024 ** 4)
  })
  it('无单位按字节', () => {
    expect(parseSize('4096')).toBe(4096)
  })
  it('非法输入返回 null', () => {
    expect(parseSize('abc')).toBeNull()
    expect(parseSize('')).toBeNull()
  })
})

describe('detectConnection', () => {
  it('IP:port 序列号判为 wifi', () => {
    expect(detectConnection('192.168.1.5:5555')).toBe('wifi')
    expect(detectConnection('10.0.0.2:40123')).toBe('wifi')
  })
  it('普通序列号判为 usb,模拟器为 unknown', () => {
    expect(detectConnection('ZYPZ261A01M69500015')).toBe('usb')
    expect(detectConnection('emulator-5554')).toBe('unknown')
  })
})

describe('readScreen(PZ261A 实测样本)', () => {
  it('物理分辨率与密度;Override 优先', async () => {
    const dc = mockClient({
      'wm size': 'Physical size: 1200x2670\nOverride size: 1200x2664',
      'wm density': 'Physical density: 520',
    })
    expect(await readScreen(dc)).toEqual({ width: 1200, height: 2664, density: 520 })
  })
})

describe('readBattery(实测样本)', () => {
  it('电量与充电状态(USB powered)', async () => {
    const dc = mockClient({
      'dumpsys battery': `
Current Battery Service state:
  AC powered: false
  USB powered: true
  status: 2
  level: 100
`,
    })
    expect(await readBattery(dc)).toEqual({ level: 100, charging: true })
  })
  it('未充电时不标记 charging', async () => {
    const dc = mockClient({
      'dumpsys battery': '  AC powered: false\n  USB powered: false\n  status: 3\n  level: 85\n',
    })
    expect(await readBattery(dc)).toEqual({ level: 85, charging: false })
  })
})

describe('readStorage(实测样本:df -k /data,挂载点为 /data/user/0)', () => {
  it('解析 1K-blocks 列', async () => {
    const dc = mockClient({
      'df -k /data':
        'Filesystem       1K-blocks      Used Available Use% Mounted on\n' +
        '/dev/block/dm-57 223842124 118437716 105273336  53% /data/user/0\n',
    })
    expect(await readStorage(dc)).toEqual({
      totalBytes: 223842124 * 1024,
      freeBytes: 105273336 * 1024,
    })
  })
})
