/**
 * APK 安装真机探针(T33 验证闭环):
 * 用与 TransferService 上传完成后完全相同的调用(client.install)重装
 * apps/desktop/resources/android/AmooNotes.apk(同包名重装,不丢数据)。
 * 断言:
 * 1. install 调用成功返回(即「APK 拖入即装」的真实安装代码路径真机跑通)
 * 2. 安装后 pm list packages 命中 com.amoolink.notes
 */
import { AdbTransport, execOut } from '../src/index.js'
import type { DeviceClient } from '../src/index.js'
import { statSync } from 'node:fs'
import { join } from 'node:path'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const PACKAGE = 'com.amoolink.notes'
const APK = join(process.cwd(), '..', '..', 'apps', 'desktop', 'resources', 'android', 'AmooNotes.apk')

async function main(): Promise<void> {
  const size = statSync(APK).size
  console.log(`APK: ${APK}(${(size / 1024 / 1024).toFixed(2)} MB)`)

  const transport = new AdbTransport()
  const handle = (await transport.listDevices()).find((h) => h.state === 'device')
  if (!handle) fail('无授权设备(state=device);若为 unauthorized 请在手机上确认调试授权弹窗')
  const client: DeviceClient = handle.client
  console.log(`设备: ${handle.serial}`)

  // ── 1. 安装前状态 ──
  const before = await execOut(client, 'pm list packages com.amoolink.notes')
  console.log(
    before.includes(PACKAGE) ? '  已安装 AmooNotes(同包名重装,pm install -r 保数据)' : '  设备上尚未安装 AmooNotes(走首次安装路径)',
  )

  // ── 2. client.install —— TransferService APK 安装的同一调用 ──
  const started = Date.now()
  await client.install(APK)
  console.log(`✓ client.install 完成(${((Date.now() - started) / 1000).toFixed(1)}s)`)

  // ── 3. 安装后断言 ──
  const after = await execOut(client, 'pm list packages com.amoolink.notes')
  if (!after.includes(PACKAGE)) fail('安装后 pm list packages 未找到 com.amoolink.notes')
  console.log('✓ pm list packages 命中 com.amoolink.notes')

  const dump = await execOut(client, 'dumpsys package com.amoolink.notes').catch(() => '')
  const version = dump.match(/versionName=(\S+)/)?.[1] ?? '未知'
  console.log(`✓ versionName=${version}`)

  console.log('APK 安装探针全部通过 ✓')
  process.exit(0)
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
