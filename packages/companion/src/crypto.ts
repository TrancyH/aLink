/**
 * 密码学原语:桌面身份证书(node-forge)、SAS 六位比对码(与手机端 Proto.kt 完全对齐)、
 * 剪贴板历史 AES-256-GCM(docs/04 §M5-6;密钥为配对时下发的 historyKey)。
 */
import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import forge from 'node-forge'

/** 生成桌面身份自签证书(RSA-2048,有效期 10 年)。 */
export function generateIdentity(): { certPem: string; keyPem: string; fingerprint: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = Date.now().toString(16) + randomBytes(4).toString('hex')
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 3650 * 86_400_000)
  const attrs = [
    { name: 'commonName', value: `AmooLink-Desktop-${randomBytes(3).toString('hex')}` },
    { name: 'organizationName', value: 'AmooLink' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const certPem = forge.pki.certificateToPem(cert)
  return {
    certPem,
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    fingerprint: fingerprintOfPem(certPem),
  }
}

/** 证书 PEM → SHA-256 指纹(hex;对 DER 直接摘要,与手机端 Proto.fp 一致,不依赖 forge 解析)。 */
export function fingerprintOfPem(certPem: string): string {
  const b64 = certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
  const der = Buffer.from(b64, 'base64')
  return createHash('sha256').update(der).digest('hex')
}

/**
 * SAS 六位比对码:HMAC-SHA256(key=OTP 大写 UTF-8,msg=transcript)前 4 字节
 * BE u32 % 1e6 补零六位 —— 与 Proto.kt#sas6 逐位一致(探针在真机做交叉验证)。
 */
export function sas6(otp: string, transcript: Buffer): string {
  const mac = createHmac('sha256', Buffer.from(otp.toUpperCase(), 'utf8')).update(transcript).digest()
  const v = mac.readUInt32BE(0)
  return String(v % 1_000_000).padStart(6, '0')
}

/** transcript = SHA256(nonceD ‖ nonceP ‖ 手机证书指纹 ‖ 桌面证书指纹)(hex → bytes)。 */
export function transcript(nonceD: Buffer, nonceP: Buffer, phoneFpHex: string, desktopFpHex: string): Buffer {
  return createHash('sha256')
    .update(nonceD)
    .update(nonceP)
    .update(Buffer.from(phoneFpHex, 'hex'))
    .update(Buffer.from(desktopFpHex, 'hex'))
    .digest()
}

// ── 剪贴板历史加密(AES-256-GCM,historyKey 为配对下发 32B)────────────

export function encryptText(historyKey: Buffer, plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', historyKey, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, data]).toString('base64')
}

export function decryptText(historyKey: Buffer, blob: string): string | null {
  try {
    const raw = Buffer.from(blob, 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const data = raw.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', historyKey, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
