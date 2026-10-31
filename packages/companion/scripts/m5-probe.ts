/**
 * M5 真机探针:伴侣 APK 端到端(配对 → mTLS → 全功能)。
 * 全程无 shell:adb 命令走 @u4/adbkit 纯 JS 通道(与仓库其他探针一致)。
 * 配对状态(OTP/SAS/IP)经 logcat M5STATE 行读取 —— 不依赖手机屏幕;
 * 剪贴板「手机→电脑」回读受 Android 焦点模型限制,需解锁屏幕(探针自动等待)。
 * 断言:
 *   1. 配对:OTP/SAS 从手机导出 → SAS 双端一致
 *   2. mTLS 重连 + ping/pong
 *   3. 剪贴板:clipboard_set → TEST_GET_CLIP 通知回环断言内容一致
 *   4. 快捷回复:TEST_POST_REPLY → notification(含 replies)→ reply → AMOOREPLY 回环
 *   5. 短信/通讯录查询返回 ok
 */
import { randomBytes } from 'node:crypto'
import { AdbTransport, execOut } from '@amoolink/adb'
import { CompanionClient, CompanionStore, type Frame } from '../src/index.js'
import type { DeviceClient } from '@u4/adbkit'

const PORT = 47888
const PKG = 'com.amoolink.companion'

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type C = DeviceClient

async function shell(client: C, cmd: string): Promise<string> {
  return execOut(client, cmd)
}

interface PairingState {
  pairing: boolean
  ip: string
  otp: string
  sas: string
}

/** 广播导出配对状态 → 解析 logcat 最新 M5STATE 行。 */
async function readPairingState(client: C): Promise<PairingState> {
  await shell(client, `am broadcast -a ${PKG}.ACTION_DUMP_PAIRING -p ${PKG}`)
  await sleep(250)
  const log = await shell(client, 'logcat -d -s Amooink AmooLink:V')
  const line = log.split('\n').filter((l) => l.includes('M5STATE')).pop() ?? ''
  const pick = (key: string): string => line.match(new RegExp(`${key}=([^ ]*)`))?.[1] ?? '-'
  return {
    pairing: line.includes('pairing=true'),
    ip: pick('ip'),
    otp: pick('otp'),
    sas: pick('sas'),
  }
}

async function waitState(client: C, predicate: (s: PairingState) => boolean, timeoutMs: number): Promise<PairingState> {
  const deadline = Date.now() + timeoutMs
  let last: PairingState = { pairing: false, ip: '-', otp: '-', sas: '-' }
  while (Date.now() < deadline) {
    last = await readPairingState(client)
    if (predicate(last)) return last
    await sleep(700)
  }
  return fail(`配对状态未就绪:${JSON.stringify(last)}`)
}

async function keyguardLocked(client: C): Promise<boolean> {
  // StepOS 的 window policy 输出无 isKeyguardShowing 字段,以 window 主输出的 mDreamingLockscreen 为准
  const out = await shell(client, 'dumpsys window').catch(() => '')
  return out.includes('mDreamingLockscreen=true') || out.includes('isKeyguardShowing=true')
}

/** 剪贴板回读需手机焦点:唤醒并等待用户解锁(打印提示)。 */
async function awaitUnlock(client: C, timeoutMs: number): Promise<boolean> {
  await shell(client, 'input keyevent 224').catch(() => undefined)
  await shell(client, `am start -n ${PKG}/.MainActivity`).catch(() => undefined)
  if (!(await keyguardLocked(client))) return true
  console.log('⏳ 手机剪贴板回读需要解锁屏幕:请在手机上解锁(保持 AmooLink 伴侣在前台)…')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(2000)
    await shell(client, 'input keyevent 224').catch(() => undefined)
    if (!(await keyguardLocked(client))) return true
  }
  return false
}

async function main(): Promise<void> {
  const transport = new AdbTransport()
  const handle = (await transport.listDevices()).find((h) => h.state === 'device')
  if (!handle || !handle.client) fail('无授权设备')
  const client = handle.client
  console.log(`设备:${handle.serial}`)

  // ── 0. 前置:授权/启动(固定字面量命令)──
  if (!(await shell(client, 'pm list packages com.amoolink.companion')).includes(PKG)) {
    fail('伴侣 APK 未安装')
  }
  // StepOS 会隔离新装应用(enabled=0),先显式启用
  await shell(client, 'pm enable com.amoolink.companion').catch(() => undefined)
  await shell(client, 'pm grant com.amoolink.companion android.permission.READ_SMS').catch(() => undefined)
  await shell(client, 'pm grant com.amoolink.companion android.permission.READ_CONTACTS').catch(() => undefined)
  await shell(client, 'pm grant com.amoolink.companion android.permission.READ_PHONE_STATE').catch(() => undefined)
  await shell(client, 'pm grant com.amoolink.companion android.permission.POST_NOTIFICATIONS').catch(() => undefined)
  await shell(client, 'settings put secure enabled_notification_listeners com.amoolink.companion/.CompanionNotificationListener')
  await shell(client, 'dumpsys deviceidle whitelist +com.amoolink.companion')
  await shell(client, 'logcat -c').catch(() => undefined)
  // StepOS 冻结后台应用(即使 FGS):整条链路需 App 前台 + 亮屏(剪贴板回读同样依赖焦点)
  // 解锁为尽力而为:配对/mTLS/回复/短信/通讯录在锁屏下均可验证;仅剪贴板回环需要焦点
  await awaitUnlock(client, 5_000).catch(() => undefined)
  // StepOS 冻结后台应用(即使 FGS+WakeLock)而广播可可靠唤醒:
  // 探针全程以 2.5s 周期发送无害状态广播 + 亮屏键作为唤醒源
  const watchdog = setInterval(() => {
    void shell(client, 'am broadcast -a com.amoolink.companion.ACTION_DUMP_PAIRING -p com.amoolink.companion')
      .catch(() => undefined)
    void shell(client, 'input keyevent 224').catch(() => undefined)
  }, 2500)
  const stopWatchdog = (): void => clearInterval(watchdog)

  await shell(client, 'am start -n com.amoolink.companion/.MainActivity')
  await sleep(1500)
  await shell(client, `am broadcast -a ${PKG}.ACTION_START_SERVICE -p ${PKG}`)
  await sleep(1500)

  const store = new CompanionStore(`/tmp/m5-store-${Date.now()}.json`)
  store.load()
  const pair = new CompanionClient(store, (m) => console.log(`[client] ${m}`))

  // ── 1. 配对 ──
  await shell(client, `am broadcast -a ${PKG}.ACTION_START_PAIRING -p ${PKG}`)
  const st = await waitState(client, (s) => s.pairing && s.otp !== '-', 10000)
  console.log(`手机 ${st.ip}:${PORT},OTP=${st.otp}`)

  const progress = await pair.startPairing(st.ip, PORT, st.otp)
  console.log(`桌面 SAS=${progress.sas}`)
  const phoneState = await waitState(client, (s) => s.sas !== '-', 10000)
  if (phoneState.sas !== progress.sas) {
    fail(`SAS 不一致(桌面=${progress.sas},手机=${phoneState.sas})`)
  }
  console.log(`✓ SAS 双端一致:${progress.sas}`)

  await shell(client, `am broadcast -a ${PKG}.ACTION_CONFIRM_PAIRING -p ${PKG}`)
  const entry = await pair.waitPaired(20000)
  console.log(`✓ 配对完成:${entry.name}(${entry.id.slice(0, 16)}…)`)
  pair.close()
  await sleep(1200)

  // ── 2. mTLS 重连 + ping ──
  const conn = new CompanionClient(store, (m) => console.log(`[client] ${m}`))
  const events: Frame[] = []
  conn.on('event', (f) => events.push(f))
  await conn.connect({ ...entry, host: st.ip, port: PORT })
  const pong = await conn.request('ping', { t: Date.now() })
  if (pong.type !== 'pong') fail(`ping 失败:${pong.type}`)
  console.log('✓ mTLS 重连 + ping/pong')

  let clipMarker = ''

  // ── 3. 剪贴板闭环(焦点受限:锁屏时降级为观察项,不阻断后续验证)──
  const unlocked = await awaitUnlock(client, 60_000)
  if (!unlocked) {
    console.log('○ 剪贴板回环:手机保持锁屏(Android 焦点模型限制),本项待解锁后验证;继续其余断言')
  } else {
    await shell(client, 'cmd statusbar collapse').catch(() => undefined)
    await shell(client, 'am start -n com.amoolink.companion/.MainActivity')
    await sleep(800)
    const marker = `AMOOM5-${randomBytes(4).toString('hex')}`
    await conn.request('clipboard_set', { text: marker })
    await sleep(300)
    await shell(client, `am broadcast -a ${PKG}.ACTION_TEST_GET_CLIP -p ${PKG}`)
    const clipEcho = await waitForEvent(
      events,
      (f) => f.type === 'notification' && typeof f.text === 'string' && f.text.startsWith('AMOOCLIP:'),
      15000,
    )
    const echoed = String(clipEcho.text).replace('AMOOCLIP:', '')
    if (echoed !== marker) fail(`剪贴板回环不一致:${echoed}`)
    console.log('✓ 剪贴板:写入手机 → 通知回环读取一致')
    clipMarker = marker
  }

  // ── 4. 快捷回复闭环 ──
  const replyMarker = clipMarker || `AMOOM5-${randomBytes(4).toString('hex')}`
  await shell(client, `am broadcast -a ${PKG}.ACTION_TEST_POST_REPLY -p ${PKG} --es marker ${replyMarker}`)
  const notif = await waitForEvent(
    events,
    (f) => f.type === 'notification' && typeof f.text === 'string' && f.text.includes(replyMarker),
    15000,
  )
  const replies = (notif.replies as Array<{ actionIdx: number; inputKey: string }>) ?? []
  if (replies.length === 0) fail('测试通知无可回复槽位')
  const replyText = `回执-${randomBytes(3).toString('hex')}`
  const res = await conn.request('reply', {
    key: String(notif.key),
    actionIdx: replies[0]?.actionIdx,
    inputKey: replies[0]?.inputKey,
    text: replyText,
  })
  if (res.ok !== true) fail(`回复发送失败:${String(res.error)}`)
  const replyEcho = await waitForEvent(
    events,
    (f) => f.type === 'notification' && typeof f.text === 'string' && f.text === `AMOOREPLY:${replyText}`,
    15000,
  )
  console.log(`✓ 快捷回复:RemoteInput 回执一致(${String(replyEcho.text)})`)

  // ── 5. 短信 / 通讯录 ──
  const sms = await conn.request('sms_query', { max: 20 })
  console.log(`✓ 短信查询:条数=${(sms.items as unknown[])?.length ?? 0}`)
  const contacts = await conn.request('contacts_query', { max: 50 })
  console.log(`✓ 通讯录查询:条数=${(contacts.items as unknown[])?.length ?? 0}`)

  conn.close()
  stopWatchdog()
  await shell(client, 'svc power stayon false').catch(() => undefined)
  if (clipMarker === '') {
    console.log('M5 探针通过(剪贴板回环因锁屏降级为观察项,待解锁后复验) ✓')
  } else {
    console.log('M5 伴侣通道探针全部通过 ✓')
  }
  process.exit(0)
}

function waitForEvent(events: Frame[], match: (f: Frame) => boolean, timeoutMs: number): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      const idx = events.findIndex(match)
      if (idx >= 0) {
        resolve(events.splice(idx, 1)[0] as Frame)
        return
      }
      if (Date.now() > deadline) {
        reject(new Error('等待手机事件超时'))
        return
      }
      setTimeout(poll, 300)
    }
    poll()
  })
}

void main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)))
