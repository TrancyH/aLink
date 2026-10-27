import type { AdbDeviceHandle, DeviceClientLike } from './adb-transport.js'
import { execOut } from './adb-transport.js'
import type { DeviceInfo } from './types.js'

/**
 * 采集一台设备的档案信息。任何子项失败都不阻断整体(字段保持 undefined),
 * 设备刚连接、未授权或厂商定制时部分命令可能失败。
 */
export async function collectDeviceInfo(handle: AdbDeviceHandle): Promise<DeviceInfo> {
  const dc = handle.client
  const base: DeviceInfo = {
    serial: handle.serial,
    state: handle.state,
    connection: detectConnection(handle.serial),
    lastUpdated: Date.now(),
  }

  const [props, screen, battery, storage] = await Promise.all([
    safe(() => getProperties(dc)),
    safe(() => readScreen(dc)),
    safe(() => readBattery(dc)),
    safe(() => readStorage(dc)),
  ])

  return {
    ...base,
    model: props?.['ro.product.model'],
    brand: props?.['ro.product.brand'],
    manufacturer: props?.['ro.product.manufacturer'],
    codename: props?.['ro.product.device'],
    androidVersion: props?.['ro.build.version.release'],
    sdkInt: toInt(props?.['ro.build.version.sdk']),
    abi: props?.['ro.product.cpu.abilist']?.split(',')[0],
    screen,
    battery,
    storage,
  }
}

/** 优先使用 adbkit 内建 getProperties,失败时回退到解析 getprop 输出。 */
async function getProperties(dc: DeviceClientLike): Promise<Record<string, string>> {
  if (typeof dc.getProperties === 'function') {
    try {
      return await dc.getProperties()
    } catch {
      // 回退到手动解析
    }
  }
  const out = await execOut(dc, 'getprop')
  return parseGetprop(out)
}

export function parseGetprop(output: string): Record<string, string> {
  const props: Record<string, string> = {}
  const re = /^\[([^\]]+)\]:\s*\[(.*)\]$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(output)) !== null) {
    if (m[1] !== undefined) props[m[1]] = m[2] ?? ''
  }
  return props
}

/** 解析 `wm size` / `wm density` 输出;Override 值(若存在)优先于 Physical。 */
export async function readScreen(dc: DeviceClientLike): Promise<DeviceInfo['screen']> {
  const sizeOut = await execOut(dc, 'wm size')
  const densityOut = await execOut(dc, 'wm density')
  const override = /Override size:\s*(\d+)x(\d+)/.exec(sizeOut)
  const physical = /Physical size:\s*(\d+)x(\d+)/.exec(sizeOut)
  const size = override ?? physical
  if (!size) return undefined
  const density =
    /Override density:\s*(\d+)/.exec(densityOut) ?? /Physical density:\s*(\d+)/.exec(densityOut)
  return {
    width: Number(size[1]),
    height: Number(size[2]),
    density: density?.[1] !== undefined ? Number(density[1]) : 0,
  }
}

/** 解析 `dumpsys battery` 的电量与充电状态。 */
export async function readBattery(dc: DeviceClientLike): Promise<DeviceInfo['battery']> {
  const out = await execOut(dc, 'dumpsys battery')
  const level = /level:\s*(\d+)/.exec(out)
  if (!level) return undefined
  const powered = /(AC|USB|Wireless) powered:\s*true/.test(out)
  const statusCharging = /status:\s*[25]/.test(out)
  return {
    level: Number(level[1]),
    charging: powered || statusCharging,
  }
}

/**
 * 解析 `df -k /data` 的存储用量。
 * 实测(Android 16 / toybox):列为 Filesystem 1K-blocks Used Avail Use% Mount,
 * 挂载点显示为 /data/user/0 而非 /data,故按行尾挂载点前缀 /data 匹配。
 */
export async function readStorage(dc: DeviceClientLike): Promise<DeviceInfo['storage']> {
  const out = await execOut(dc, 'df -k /data')
  const line = out
    .split('\n')
    .map((l) => l.trim())
    .find((l) => {
      const tokens = l.split(/\s+/)
      return tokens.length >= 6 && (tokens[tokens.length - 1] ?? '').startsWith('/data')
    })
  if (!line) return undefined
  const tokens = line.split(/\s+/)
  const totalK = Number(tokens[1])
  const availK = Number(tokens[tokens.length - 3])
  if (!Number.isFinite(totalK) || !Number.isFinite(availK)) return undefined
  return { totalBytes: totalK * 1024, freeBytes: availK * 1024 }
}

/** "117G" / "512M" / "1024K" / "123" → 字节数;无法解析返回 null。 */
export function parseSize(token: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([KMGT]?)$/.exec(token.trim())
  if (!m || m[1] === undefined) return null
  const value = Number(m[1])
  const unit = m[2] ?? ''
  const factor = unit === 'K' ? 1024 : unit === 'M' ? 1024 ** 2 : unit === 'G' ? 1024 ** 3 : unit === 'T' ? 1024 ** 4 : 1
  return Math.round(value * factor)
}

/** 序列号形如 192.168.1.5:5555 判为无线连接。 */
export function detectConnection(serial: string): DeviceInfo['connection'] {
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(serial)) return 'wifi'
  if (serial.startsWith('emulator-')) return 'unknown'
  return 'usb'
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch {
    return undefined
  }
}
