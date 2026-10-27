/**
 * M2 真机集成探针:文件互传协议层端到端验证。
 *
 * 断言(全部通过退出 0):
 * 1. 2MB 随机文件 push → 设备端 md5 与本地一致
 * 2. readdir /sdcard/Download 能看到该文件且大小一致
 * 3. pull 回本地 → md5 与源一致
 * 4. rm 后文件消失
 *
 * 运行:pnpm -F @amoolink/adb exec tsx scripts/m2-probe.ts
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, rm, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdbTransport, execOut } from '../src/index.js'

const SIZE = 2 * 1024 * 1024
const REMOTE = '/sdcard/Download/amoolink-m2-test.bin'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function md5(buf: Buffer): string {
  return createHash('md5').update(buf).digest('hex')
}

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handles = await transport.listDevices().catch(() => fail('无法连接 adb server'))
  const handle = handles.find((h) => h.state === 'device') ?? fail('没有处于 device 状态的设备')
  const client = handle.client
  console.log(`目标设备: ${handle.serial}`)

  // 1. 造 2MB 随机文件
  const localSrc = join(tmpdir(), 'amoolink-m2-src.bin')
  await writeFile(localSrc, Buffer.alloc(SIZE, 0).map(() => Math.floor(Math.random() * 256)))
  const srcBuf = await readFile(localSrc)
  const srcMd5 = md5(srcBuf)
  console.log(`本地文件就绪: ${SIZE}B md5=${srcMd5.slice(0, 12)}…`)

  // 2. 上传
  console.log('上传中…')
  const t0 = Date.now()
  const push = await client.push(createReadStream(localSrc), REMOTE, 0o644)
  let pushed = 0
  push.on('progress', (s: { bytesTransferred: number }) => {
    pushed = s.bytesTransferred
  })
  await push.waitForEnd()
  const upMs = Date.now() - t0
  console.log(`✓ 上传完成: ${pushed}B / ${upMs}ms(${((pushed / 1024 / 1024) / (upMs / 1000)).toFixed(1)}MB/s)`)

  // 3. 设备端 md5
  const remoteMd5Out = await execOut(client, `md5sum '${REMOTE}'`)
  const remoteMd5 = /^\s*([0-9a-f]{32})/.exec(remoteMd5Out)?.[1] ?? fail('md5sum 输出异常: ' + remoteMd5Out)
  if (remoteMd5 !== srcMd5) fail(`设备端 md5 不一致: ${remoteMd5} != ${srcMd5}`)
  console.log(`✓ 设备端 md5 一致`)

  // 4. readdir 断言
  const sync = await client.syncService()
  const entries = await sync.readdir('/sdcard/Download')
  sync.end()
  const found = entries.find((e) => e.name === 'amoolink-m2-test.bin')
  if (!found) fail('readdir 未找到上传文件')
  if (Number(found.size) !== SIZE) fail(`远端大小 ${found.size} != ${SIZE}`)
  console.log(`✓ readdir: ${entries.length} 个条目,目标文件大小 ${found.size}B`)

  // 5. 下载
  console.log('下载中…')
  const localDst = join(tmpdir(), 'amoolink-m2-dst.bin')
  const t1 = Date.now()
  const pull = await client.pull(REMOTE)
  const ws = createWriteStream(localDst)
  let pulled = 0
  pull.on('data', (c: Buffer) => {
    pulled += c.length
  })
  pull.pipe(ws)
  await new Promise<void>((resolve, reject) => {
    ws.on('finish', () => resolve())
    ws.on('error', reject)
    pull.on('error', reject)
  })
  const downMs = Date.now() - t1
  console.log(`✓ 下载完成: ${pulled}B / ${downMs}ms(${((pulled / 1024 / 1024) / (downMs / 1000)).toFixed(1)}MB/s)`)

  const dstBuf = await readFile(localDst)
  if (md5(dstBuf) !== srcMd5) fail('下载后 md5 不一致')
  console.log('✓ 下载内容 md5 一致')

  // 6. 清理
  await execOut(client, `rm -f '${REMOTE}'`)
  const gone = await execOut(client, `ls '${REMOTE}' 2>&1 || true`)
  if (!/No such file/.test(gone)) fail(`删除失败: ${gone}`)
  console.log('✓ 设备端清理完成')

  await rm(localSrc, { force: true })
  await rm(localDst, { force: true })
  console.log('M2 探针全部通过 ✓')
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
