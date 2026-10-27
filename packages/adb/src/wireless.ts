import { spawn } from 'node:child_process'

/**
 * 无线连接能力依赖 adb CLI(adbkit 未实现 `adb pair` / `adb connect`)。
 * 二进制解析顺序:ADB_PATH 环境变量 → PATH 中的 adb;打包版在 resources/bin 提供。
 */
export function resolveAdbBinary(): string {
  return process.env['ADB_PATH'] ?? 'adb'
}

export async function adbSpawn(args: string[], timeoutMs = 30000): Promise<string> {
  const bin = resolveAdbBinary()
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`adb ${args.join(' ')} 超时(${timeoutMs}ms)`))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out.trim())
      else reject(new Error(`adb ${args.join(' ')} 失败(exit=${code}):${out.trim()}`))
    })
  })
}

/** Android 11+ 无线调试配对(手机端"无线调试 → 使用配对码配对设备")。 */
export async function pairWireless(host: string, port: number, pairingCode: string): Promise<string> {
  return adbSpawn(['pair', `${host}:${port}`, pairingCode])
}

/** 配对成功后连接无线调试端口(与配对端口不同)。 */
export async function connectWireless(host: string, port: number): Promise<string> {
  return adbSpawn(['connect', `${host}:${port}`])
}

/** 经典无线模式:USB 在线时把设备切到 tcpip 5555,之后可拔线使用。 */
export async function enableTcpip(serial: string): Promise<string> {
  return adbSpawn(['-s', serial, 'tcpip', '5555'])
}

/** mDNS 服务发现(scrpy/mdns),返回原始文本,M1 解析为设备列表。 */
export async function mdnsServices(): Promise<string> {
  return adbSpawn(['mdns', 'services'], 10000)
}
