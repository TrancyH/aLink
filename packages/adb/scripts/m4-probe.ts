/**
 * M2+ 拖拽增强真机探针:目录感知上传语义验证。
 *
 * 断言(全部通过退出 0):
 * 1. 上传到指定 remoteDir(/sdcard/Music)→ readdir 断言文件落在该目录
 * 2. 上传到默认目录(不传 remoteDir,应落 /sdcard/Download)
 * 3. 两处文件清理
 *
 * 运行:pnpm -F @amoolink/adb exec tsx scripts/m4-probe.ts
 */
import { createReadStream } from 'node:fs'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdbTransport, execOut } from '../src/index.js'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

async function upload(client: Awaited<ReturnType<AdbTransport['getDeviceClient']>>, local: string, remote: string): Promise<void> {
  const transfer = await client!.push(createReadStream(local), remote, 0o644)
  await transfer.waitForEnd()
}

async function existsIn(client: Awaited<ReturnType<AdbTransport['getDeviceClient']>>, dir: string, name: string): Promise<number> {
  const sync = await client!.syncService()
  const entries = await sync.readdir(dir)
  sync.end()
  return entries.find((e) => e.name === name)?.size ?? -1
}

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handles = await transport.listDevices().catch(() => fail('无法连接 adb server'))
  const handle = handles.find((h) => h.state === 'device') ?? fail('没有设备')
  const client = handle.client
  console.log(`目标设备: ${handle.serial}`)

  const src = join(tmpdir(), 'amoolink-m4-test.txt')
  await writeFile(src, 'm4 directory-aware upload\n')

  // 1. 目录感知:上传到 /sdcard/Music
  await execOut(client, "mkdir -p /sdcard/Music")
  await upload(client, src, '/sdcard/Music/amoolink-m4-test.txt')
  const size1 = await existsIn(client, '/sdcard/Music', 'amoolink-m4-test.txt')
  if (size1 < 0) fail('文件未出现在 /sdcard/Music(目录感知上传失败)')
  console.log(`✓ 目录感知:文件落在 /sdcard/Music(${size1}B)`)

  // 2. 默认目录语义(remoteDir 缺省 = /sdcard/Download,与 TransferService 一致)
  await upload(client, src, '/sdcard/Download/amoolink-m4-default.txt')
  const size2 = await existsIn(client, '/sdcard/Download', 'amoolink-m4-default.txt')
  if (size2 < 0) fail('文件未出现在 /sdcard/Download(默认目录失败)')
  console.log(`✓ 默认目录:文件落在 /sdcard/Download(${size2}B)`)

  // 3. 清理
  await execOut(client, "rm -f /sdcard/Music/amoolink-m4-test.txt /sdcard/Download/amoolink-m4-default.txt")
  await rm(src, { force: true })
  console.log('M4 探针全部通过 ✓')
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
