import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { generateIdentity, fingerprintOfPem, sas6, transcript, encryptText, decryptText } from '../src/crypto.js'

describe('身份证书', () => {
  it('生成自签证书且指纹稳定', () => {
    const a = generateIdentity()
    expect(a.certPem).toContain('BEGIN CERTIFICATE')
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprintOfPem(a.certPem)).toBe(a.fingerprint)
  })
})

describe('SAS 六位比对码(与手机端 Proto.kt 对齐)', () => {
  it('确定性:同输入同输出', () => {
    const nonceD = Buffer.alloc(16, 1)
    const nonceP = Buffer.alloc(16, 2)
    const tr = transcript(nonceD, nonceP, 'ab'.repeat(32), 'cd'.repeat(32))
    expect(sas6('TESTCODE', tr)).toBe(sas6('TESTCODE', tr))
    expect(sas6('TESTCODE', tr)).toMatch(/^\d{6}$/)
  })

  it('OTP 或 transcript 任一变化则 SAS 变化(不可预测)', () => {
    const tr = transcript(Buffer.alloc(16, 1), Buffer.alloc(16, 2), 'ab'.repeat(32), 'cd'.repeat(32))
    const a = sas6('AAAAAAAA', tr)
    const b = sas6('AAAAAAAB', tr)
    const tr2 = transcript(Buffer.alloc(16, 9), Buffer.alloc(16, 2), 'ab'.repeat(32), 'cd'.repeat(32))
    const c = sas6('AAAAAAAA', tr2)
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('剪贴板历史加密(AES-256-GCM)', () => {
  it('加解密往返', () => {
    const key = randomBytes(32)
    const blob = encryptText(key, '剪贴板历史条目 #1')
    expect(blob).not.toContain('剪贴板')
    expect(decryptText(key, blob)).toBe('剪贴板历史条目 #1')
  })

  it('错误密钥/篡改返回 null', () => {
    const blob = encryptText(randomBytes(32), 'secret')
    expect(decryptText(randomBytes(32), blob)).toBeNull()
    const tampered = blob.slice(0, -4) + 'AAAA'
    const key = Buffer.alloc(32, 7)
    const b2 = encryptText(key, 'secret')
    const t2 = (Buffer.from(b2.slice(0, -4) + 'AAAA', 'base64')).toString('base64')
    expect(decryptText(key, t2)).toBeNull()
    expect(tampered).not.toBe(b2)
  })
})
