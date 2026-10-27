import { describe, expect, it } from 'vitest'
import { generateScid } from '../src/scrcpy-session.js'

describe('generateScid', () => {
  it('8 位小写十六进制', () => {
    const scid = generateScid()
    expect(scid).toMatch(/^[0-9a-f]{8}$/)
  })

  it('值 ≤ 0x7fffffff(服务端 Integer.parseInt(s,16) 约束)', () => {
    for (let i = 0; i < 50; i++) {
      expect(Number.parseInt(generateScid(), 16)).toBeLessThanOrEqual(0x7fffffff)
    }
  })

  it('随机分布(100 次采样不重复)', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateScid()))
    expect(seen.size).toBe(100)
  })
})
