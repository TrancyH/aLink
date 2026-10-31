/**
 * 桌面端配对档案:身份密钥对 + 已配对手机列表,持久化为 JSON(0600)。
 * 私钥不入密钥库属 v1 妥协(docs/04 §4.3 的 Keychain/DPAPI 包裹列为后续加固)。
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { generateIdentity } from './crypto.js'

export interface PairedPhone {
  /** 手机证书 SHA-256 指纹(hex),作为稳定 ID。 */
  id: string
  /** 手机型号名(配对时上报)。 */
  name: string
  /** 手机身份证书 PEM(mTLS 钉扎)。 */
  certPem: string
  /** 配对下发的剪贴板历史密钥(base64,32B;仅本桌面与该手机可解)。 */
  historyKey: string
  pairedAt: number
  lastSeenAt?: number
}

export interface CompanionStoreData {
  identity: { certPem: string; keyPem: string; fingerprint: string }
  phones: PairedPhone[]
}

export class CompanionStore {
  private data: CompanionStoreData | null = null

  constructor(private readonly file: string) {}

  load(): CompanionStoreData {
    if (this.data) return this.data
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<CompanionStoreData>
        if (raw.identity && Array.isArray(raw.phones)) {
          this.data = raw as CompanionStoreData
          return this.data
        }
      } catch {
        // 损坏文件回退重建
      }
    }
    const identity = generateIdentity()
    this.data = { identity, phones: [] }
    this.save()
    return this.data
  }

  save(): void {
    const data = this.load()
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(data, null, 2), { mode: 0o600 })
    try {
      chmodSync(this.file, 0o600)
    } catch {
      /* Windows 无 mode */
    }
  }

  identity(): CompanionStoreData['identity'] {
    return this.load().identity
  }

  phones(): PairedPhone[] {
    return [...this.load().phones]
  }

  phone(id: string): PairedPhone | undefined {
    return this.load().phones.find((p) => p.id === id)
  }

  upsertPhone(entry: PairedPhone): void {
    const data = this.load()
    const idx = data.phones.findIndex((p) => p.id === entry.id)
    if (idx >= 0) data.phones[idx] = { ...data.phones[idx], ...entry }
    else data.phones.push(entry)
    this.save()
  }

  touch(id: string): void {
    const phone = this.load().phones.find((p) => p.id === id)
    if (phone) {
      phone.lastSeenAt = Date.now()
      this.save()
    }
  }

  forget(id: string): void {
    const data = this.load()
    data.phones = data.phones.filter((p) => p.id !== id)
    this.save()
  }
}

export function defaultStorePath(dir: string): string {
  return join(dir, 'companion.json')
}
