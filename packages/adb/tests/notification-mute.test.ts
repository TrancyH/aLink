import { describe, expect, it } from 'vitest'
import { applyMuted, diffNewNotifications, type NotificationItem } from '../src/notification-parser.js'

function item(pkg: string, key: string, title = 't'): NotificationItem {
  return { pkg, key, importance: 'HIGH', title, text: 'body', whenMs: 1700000000000 }
}

describe('applyMuted(按 App 免打扰)', () => {
  it('空静音表原样返回', () => {
    const items = [item('com.a.x', 'k1'), item('com.b.y', 'k2')]
    expect(applyMuted(items, [])).toBe(items)
  })

  it('命中静音表的 pkg 被过滤,其余保留', () => {
    const items = [item('com.a.x', 'k1'), item('com.b.y', 'k2'), item('com.a.x', 'k3')]
    const out = applyMuted(items, ['com.a.x'])
    expect(out.map((n) => n.key)).toEqual(['k2'])
  })

  it('基线保留完整列表 + 只过滤 diff 结果:取消静音不重放静音期间的历史', () => {
    // 服务侧语义:poll 的 diff 基线是完整列表,静音只作用于 fresh
    let baseline: NotificationItem[] = []
    const round1 = [item('com.a.x', 'k1'), item('com.b.y', 'k2')]
    // 静音 com.a.x 期间到达
    let fresh = applyMuted(diffNewNotifications(baseline, round1), ['com.a.x'])
    expect(fresh.map((n) => n.key)).toEqual(['k2'])
    baseline = round1 // 基线完整(含被静音的 k1)
    // 下一轮无新增:取消静音后不重放 k1
    const round2 = [item('com.a.x', 'k1'), item('com.b.y', 'k2')]
    fresh = applyMuted(diffNewNotifications(baseline, round2), [])
    expect(fresh).toHaveLength(0)
    // 取消静音后,新通知恢复上报
    const round3 = [...round2, item('com.a.x', 'k9')]
    fresh = applyMuted(diffNewNotifications(round2, round3), [])
    expect(fresh.map((n) => n.key)).toEqual(['k9'])
  })
})
