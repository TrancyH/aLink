import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseNotifications, diffNewNotifications, isNoise } from '../src/notification-parser.js'

/** fixture 取自真机 StepX PZ261A(Android 16)`dumpsys notification --noredact` 实测输出。 */
const sample = readFileSync(join(__dirname, 'fixtures/notification-sample.txt'), 'utf8')

describe('parseNotifications(真机样本)', () => {
  const items = parseNotifications(sample)

  it('解析出 NotificationRecord 条目并取到 key/pkg', () => {
    expect(items.length).toBeGreaterThanOrEqual(2)
    expect(items[0]?.pkg).toBe('hello.litiaotiao.app')
    const shell = items.find((n) => n.pkg === 'com.android.shell')
    expect(shell?.key).toContain('com.android.shell')
  })

  it('cmd notification post 的通知:title/text/when 解析', () => {
    const shell = items.find((n) => n.pkg === 'com.android.shell')
    expect(shell).toBeDefined()
    expect(shell?.title).toBe('AmooLink')
    expect(shell?.text).toContain('amoolink')
    expect(shell?.whenMs).toBeGreaterThan(1700000000000)
  })

  it('重复 key 不去重(去重交给 diff)', () => {
    const shellItems = items.filter((n) => n.key === items.find((i) => i.pkg === 'com.android.shell')?.key)
    // fixture 中 shell 块出现两次(重复抓取),解析器如实保留
    expect(shellItems.length).toBe(2)
  })
})

describe('diffNewNotifications', () => {
  const a = [
    { key: 'k1', pkg: 'p1', title: 't', text: 'x', whenMs: 1, importance: 'HIGH' },
  ]
  const b = [
    ...a,
    { key: 'k2', pkg: 'p2', title: '新', text: 'y', whenMs: 2, importance: 'HIGH' },
  ]

  it('仅返回新增 key', () => {
    const fresh = diffNewNotifications(a, b)
    expect(fresh.map((n) => n.key)).toEqual(['k2'])
  })

  it('条目消失不产生新增', () => {
    expect(diffNewNotifications(b, a)).toEqual([])
  })
})

describe('isNoise', () => {
  const base = { pkg: 'com.x', title: 'T', text: 'B', whenMs: 0, importance: 'HIGH' }
  it('android 前缀与 MIN 优先级与空内容过滤', () => {
    expect(isNoise({ ...base, pkg: 'android' })).toBe(true)
    expect(isNoise({ ...base, importance: 'MIN' })).toBe(true)
    expect(isNoise({ ...base, title: '', text: '' })).toBe(true)
    expect(isNoise(base)).toBe(false)
  })
})
