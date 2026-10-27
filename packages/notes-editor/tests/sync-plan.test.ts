import { describe, expect, it } from 'vitest'
import { mergeManifests, planSync, type SideState } from '../src/sync-plan'

const side = (files: Record<string, string>, manifest: SideState['manifest'] = {}): SideState => ({
  files,
  manifest,
})

const E = (md5: string, deletedAt: number | null = null) => ({ md5, mtime: 0, deletedAt })

describe('planSync', () => {
  it('首次同步:本地 3 条、远端空 → 全部 push', () => {
    const plan = planSync(side({ a: '1', b: '2', c: '3' }), side({}))
    expect(plan).toEqual([
      { type: 'push', id: 'a' },
      { type: 'push', id: 'b' },
      { type: 'push', id: 'c' },
    ])
  })

  it('首次同步:远端 2 条、本地空(新装桌面)→ 全部 pull', () => {
    const plan = planSync(side({}), side({ x: '9', y: '8' }))
    expect(plan).toEqual([
      { type: 'pull', id: 'x' },
      { type: 'pull', id: 'y' },
    ])
  })

  it('一致时 noop(含 base 相同)', () => {
    const plan = planSync(side({ a: '1' }, { a: E('1') }), side({ a: '1' }, { a: E('1') }))
    expect(plan).toEqual([{ type: 'noop', id: 'a' }])
  })

  it('本地改(base==remote)→ push', () => {
    const plan = planSync(side({ a: 'NEW' }, { a: E('OLD') }), side({ a: 'OLD' }, { a: E('OLD') }))
    expect(plan).toEqual([{ type: 'push', id: 'a' }])
  })

  it('远端改(base==local)→ pull', () => {
    const plan = planSync(side({ a: 'OLD' }, { a: E('OLD') }), side({ a: 'NEW' }, { a: E('OLD') }))
    expect(plan).toEqual([{ type: 'pull', id: 'a' }])
  })

  it('双改(base 不同两边)→ conflict', () => {
    const plan = planSync(side({ a: 'L' }, { a: E('B') }), side({ a: 'R' }, { a: E('B') }))
    expect(plan).toEqual([{ type: 'conflict', id: 'a' }])
  })

  it('本地删除(tombstone)→ delete-remote', () => {
    const plan = planSync(side({}, { a: E('OLD', 1000) }), side({ a: 'OLD' }, { a: E('OLD') }))
    expect(plan).toEqual([{ type: 'delete-remote', id: 'a' }])
  })

  it('远端删除(tombstone)→ delete-local', () => {
    const plan = planSync(side({ a: 'OLD' }, { a: E('OLD') }), side({}, { a: E('OLD', 1000) }))
    expect(plan).toEqual([{ type: 'delete-local', id: 'a' }])
  })

  it('本地已删但远端之后又改 → conflict(不覆盖远端新内容)', () => {
    const plan = planSync(side({}, { a: E('OLD', 1000) }), side({ a: 'R-NEW' }, { a: E('OLD') }))
    expect(plan).toEqual([{ type: 'conflict', id: 'a' }])
  })

  it('同步后新设备加入(manifest 空)不误删对端 → pull/push', () => {
    // 本地无 a、无 tombstone;远端有 a 且无 manifest(base 退 remote.manifest 也无)→ pull
    const plan = planSync(side({}), side({ a: 'R' }))
    expect(plan).toEqual([{ type: 'pull', id: 'a' }])
  })

  it('计划按 id 字典序稳定输出', () => {
    const plan = planSync(side({ c: '3', a: '1', b: '2' }), side({}))
    expect(plan.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('mergeManifests', () => {
  it('存活条目记新 md5,tombstone 归零', () => {
    const merged = mergeManifests(
      { a: E('1'), d: E('2') },
      { a: E('1') },
      { a: '1', d: null },
      5000,
    )
    expect(merged['a']).toEqual({ md5: '1', mtime: 5000, deletedAt: null })
    expect(merged['d']!.deletedAt).toBe(5000)
  })

  it('tombstone 时间取双端较新', () => {
    const merged = mergeManifests({ a: E('1', 100) }, { a: E('1', 900) }, { a: null }, 5000)
    expect(merged['a']!.deletedAt).toBe(900)
  })

  it('从未存在且被删的 id 不落条目', () => {
    const merged = mergeManifests({}, {}, { ghost: null }, 5000)
    expect(merged['ghost']).toBeUndefined()
  })
})
