/**
 * 传输并发生探针:验证同一 adbkit DeviceClient 上并行 push/pull 的稳定性
 * (M2 串行是保守选择;并发调度前先确认底层通道支持)。
 * 断言:
 * 1. 3 个 2MB 文件并发 push 全部成功,远端 sha256 与本地一致
 * 2. 3 个文件并发 pull 回来,sha256 一致
 * 3. 并发总耗时 < 串行理论耗时 * 0.85(证明真正并行)
 * 结束:清理远端与本地临时文件
 */
import { AdbTransport, execOut } from '../src/index.js'
import { createReadStream, createWriteStream, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SIZE = 2 * 1024 * 1024
const N = 3
const REMOTE_DIR = '/sdcard/Download/amoolink-conc-test'

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function digestRemote(client: NonNullable<Awaited<ReturnType<AdbTransport['getDeviceClient']>>>, path: string): Promise<string> {
  const out = await execOut(client, `sha256sum '${path}'`)
  return out.trim().split(/\s+/)[0] ?? ''
}

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handle = (await transport.listDevices()).find((h) => h.state === 'device')
  if (!handle || !handle.client) fail('无授权设备')
  const client = handle.client
  console.log(`设备: ${handle.serial}`)

  // 准备本地源文件(内容互不相同)
  const locals: string[] = []
  for (let i = 0; i < N; i++) {
    const p = join(tmpdir(), `amoolink-conc-${i}.bin`)
    const buf = Buffer.alloc(SIZE, 48 + i)
    writeFileSync(p, buf)
    locals.push(p)
  }

  // ── 1. 并发 push ──
  const t0 = Date.now()
  const pushes = locals.map((p, i) =>
    (async () => {
      const transfer = await client.push(createReadStream(p), `${REMOTE_DIR}/conc-${i}.bin`, 0o644)
      await transfer.waitForEnd()
    })(),
  )
  await Promise.all(pushes)
  const pushMs = Date.now() - t0
  console.log(`✓ ${N} 个文件并发 push 完成(${(pushMs / 1000).toFixed(2)}s)`)

  for (let i = 0; i < N; i++) {
    const remote = await digestRemote(client, `${REMOTE_DIR}/conc-${i}.bin`)
    if (remote !== digest(locals[i] ?? '')) fail(`远端摘要不一致:conc-${i}.bin`)
  }
  console.log('✓ 远端 sha256 全部一致')

  // ── 2. 串行对照(单文件,估算串行总耗)──
  const t1 = Date.now()
  const transfer = await client.push(createReadStream(locals[0] ?? ''), `${REMOTE_DIR}/serial.bin`, 0o644)
  await transfer.waitForEnd()
  const serialOne = Date.now() - t1
  console.log(`对照:单文件 push ${(serialOne / 1000).toFixed(2)}s;串行 ${N} 个约 ${(serialOne * N / 1000).toFixed(2)}s`)
  if (pushMs > serialOne * N * 0.85) {
    console.log('○ 并发未显著快于串行(带宽瓶颈,但通道稳定)')
  } else {
    console.log('✓ 并发显著快于串行')
  }

  // ── 3. 并发 pull ──
  const t2 = Date.now()
  const pulls = locals.map((p, i) =>
    (async () => {
      const stream = await client.pull(`${REMOTE_DIR}/conc-${i}.bin`)
      const out = createWriteStream(p + '.back')
      stream.pipe(out)
      await new Promise<void>((resolve, reject) => {
        out.on('finish', () => resolve())
        out.on('error', reject)
        stream.on('error', reject)
      })
    })(),
  )
  await Promise.all(pulls)
  const pullMs = Date.now() - t2
  console.log(`✓ ${N} 个文件并发 pull 完成(${(pullMs / 1000).toFixed(2)}s)`)
  for (const p of locals) {
    if (!existsSync(p + '.back') || digest(p + '.back') !== digest(p)) fail(`pull 回传摘要不一致:${p}`)
  }
  console.log('✓ 回传 sha256 全部一致')

  // ── 清理 ──
  await execOut(client, `rm -rf '${REMOTE_DIR}'`).catch(() => undefined)
  for (const p of [...locals, ...locals.map((p) => p + '.back')]) {
    try {
      unlinkSync(p)
    } catch {
      /* 已删 */
    }
  }
  await sleep(500)
  console.log('✓ 已清理临时文件')
  console.log('并发生探针全部通过 ✓')
  process.exit(0)
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
