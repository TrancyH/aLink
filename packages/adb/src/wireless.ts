import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 无线连接能力依赖 adb CLI(adbkit 未实现 `adb pair` / `adb connect`)。
 * 二进制解析顺序:ADB_PATH / AMOOLINK_ADB_BIN 环境变量(仅接受纯路径字符的绝对路径)→
 * Electron 打包版 resources/bin/<platform>/adb(extraResources)→
 * 开发仓内 resources/bin(向上查找)→ PATH 中的 adb。
 */
function envAdbOverride(): string | null {
  const raw = process.env['ADB_PATH'] ?? process.env['AMOOLINK_ADB_BIN']
  if (!raw) return null
  // 环境变量只允许绝对路径形态(禁参数/命令分隔符),避免注入可执行命令行
  if (!/^(\/[A-Za-z0-9._/-]+|[A-Za-z]:[\\/][A-Za-z0-9._-]+)$/.test(raw)) return null
  return existsSync(raw) ? raw : null
}

export function resolveAdbBinary(): string {
  const override = envAdbOverride()
  if (override) return override
  const platformDir = process.platform === 'win32' ? 'win32' : 'darwin'
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb'
  const candidates: string[] = []
  // Electron 打包版:process.resourcesPath 指向 .app/Contents/Resources
  const resourcesPath = (process as { resourcesPath?: unknown }).resourcesPath
  if (
    typeof resourcesPath === 'string' &&
    /^(\/[A-Za-z0-9._/-]+|[A-Za-z]:[\\/][A-Za-z0-9._-]+)$/.test(resourcesPath)
  ) {
    candidates.push(join(resourcesPath, 'resources', 'bin', platformDir, exe))
  }
  // 开发/探针:从模块位置与 cwd 向上找仓库内 apps/desktop/resources/bin
  const roots = [process.cwd()]
  try {
    roots.push(fileURLToPath(new URL('.', import.meta.url)))
  } catch {
    /* 非 ESM 上下文,跳过 */
  }
  for (const root of roots) {
    let dir = root
    for (let i = 0; i < 8; i++) {
      candidates.push(join(dir, 'resources', 'bin', platformDir, exe))
      candidates.push(join(dir, 'apps', 'desktop', 'resources', 'bin', platformDir, exe))
      const parent = join(dir, '..')
      if (parent === dir) break
      dir = parent
    }
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* 不可读,继续 */
    }
  }
  return 'adb'
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

/** mDNS 发现的服务条目。kind=connect 可直接连接;kind=pairing 需先配对。 */
export interface MdnsServiceInfo {
  kind: 'connect' | 'pairing'
  host: string
  port: number
  /** mDNS 实例名(形如 <guid>._adb-tls-connect._tcp);前缀 guid 可作设备标识。 */
  instance: string
}

const MDNS_SERVICE_HEAD = /^adb-tls-(connect|pairing)\._tcp$/
const MDNS_ADDR_TOKEN = /\s(\S+:\d+)\s/

/**
 * 解析 `adb mdns services` 输出(新旧两种版式、CRLF、无服务/后端未起均兼容):
 * 新版每行 "- adb-tls-connect._tcp   192.168.1.5:43505   <guid>._adb-tls-connect._tcp",
 * 旧版无 "-" 前缀,列相同。
 */
export function parseMdnsServices(out: string): MdnsServiceInfo[] {
  const result: MdnsServiceInfo[] = []
  const seen = new Set<string>()
  for (const rawLine of out.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*-\s*/, '').trim()
    const columns = line.split(/\s+/)
    const head = columns[0]?.match(MDNS_SERVICE_HEAD)
    if (!head) continue
    const kind = head[1] as 'connect' | 'pairing'
    // 地址列:按"主机:端口"整体取词(最后一个冒号分隔,兼容 IPv6 [::]:port)
    const addrToken = ` ${line} `.match(MDNS_ADDR_TOKEN)?.[1]
    if (!addrToken) continue
    const colon = addrToken.lastIndexOf(':')
    const host = addrToken.slice(0, colon)
    const portText = addrToken.slice(colon + 1)
    if (host === '' || !/^\d+$/.test(portText)) continue
    const port = Number.parseInt(portText, 10)
    // 实例名列(<guid>._adb-tls-*._tcp);缺省时用地址拼一个
    const instanceCol = columns.find((t) => t !== head[0] && t !== addrToken && t.endsWith('_tcp'))
    const instance = instanceCol ?? `${host}_port${portText}._adb-tls-${kind}._tcp`
    const key = `${kind}|${host}:${portText}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ kind, host, port, instance })
  }
  // connect 服务排前(可直接连),pairing 需配对
  return result.sort((a, b) =>
    a.kind === b.kind ? a.instance.localeCompare(b.instance) : a.kind === 'connect' ? -1 : 1,
  )
}

/** mDNS 服务发现:解析 `adb mdns services` 为结构化设备列表。 */
export async function mdnsServices(): Promise<MdnsServiceInfo[]> {
  return parseMdnsServices(await adbSpawn(['mdns', 'services'], 10000))
}
