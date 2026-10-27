import type { ManifestEntry } from './types'

/**
 * 双向同步计划器(纯函数,无 IO,可单测)。
 * 经典三方比对:base(上次同步时 md5) vs local(当前本地) vs remote(当前远端)。
 */

/** 一端的实际状态:当前磁盘/远端文件 md5 + 持久化清单(base 与 tombstone)。 */
export interface SideState {
  /** 当前实际存在的文件:id → md5(缺条目 = 文件不存在)。 */
  files: Record<string, string>
  /** 持久化 manifest:id → 上次同步 base(md5)与 tombstone。 */
  manifest: Record<string, ManifestEntry>
}

export type SyncAction =
  | { type: 'push'; id: string } // 本地覆盖远端
  | { type: 'pull'; id: string } // 远端覆盖本地
  | { type: 'delete-local'; id: string } // 远端 tombstone 传播到本地
  | { type: 'delete-remote'; id: string } // 本地删除传播到远端
  | { type: 'conflict'; id: string } // 双改:双副本策略
  | { type: 'noop'; id: string }

/** 生成同步计划(顺序稳定:按 id 字典序)。 */
export function planSync(local: SideState, remote: SideState): SyncAction[] {
  const ids = new Set<string>([
    ...Object.keys(local.files),
    ...Object.keys(remote.files),
    ...Object.keys(local.manifest),
    ...Object.keys(remote.manifest),
  ])
  return [...ids].sort().map((id) => planOne(id, local, remote))
}

function planOne(id: string, local: SideState, remote: SideState): SyncAction {
  const l = local.files[id] ?? null // null = 本地当前不存在
  const r = remote.files[id] ?? null
  const base = local.manifest[id]?.md5 ?? remote.manifest[id]?.md5 ?? null
  const lTomb = local.manifest[id]?.deletedAt != null
  const rTomb = remote.manifest[id]?.deletedAt != null

  if (l === null && r === null) return { type: 'noop', id } // 双方皆无,仅清 tombstone
  if (l !== null && r !== null && l === r) return { type: 'noop', id }

  // 一端缺失
  if (l === null) {
    if (rTomb) return { type: 'noop', id } // 远端已删,本地也无,收敛
    if (lTomb) {
      // 本地删除传播到远端;但远端在删除后又改过 → 冲突(不覆盖新内容)
      if (base !== null && base !== r) return { type: 'conflict', id }
      return { type: 'delete-remote', id }
    }
    return { type: 'pull', id } // 本端没有 → 拉入(新设备/被恢复)
  }
  if (r === null) {
    if (lTomb) return { type: 'noop', id } // 本地已删,远端也无,收敛
    if (rTomb) {
      if (base !== null && base !== l) return { type: 'conflict', id }
      return { type: 'delete-local', id }
    }
    return { type: 'push', id } // 远端没有 → 推送(首装/被恢复)
  }

  // 双方都有但不同
  if (base === l) return { type: 'pull', id }
  if (base === r) return { type: 'push', id }
  return { type: 'conflict', id }
}

/** 双端 manifest 合并(同步完成后写入两端):存在过的 id 全保留,tombstone 取较新。 */
export function mergeManifests(
  local: Record<string, ManifestEntry>,
  remote: Record<string, ManifestEntry>,
  nextMd5: Record<string, string | null>, // 同步后的最终 md5;null → 记 tombstone(now)
  now: number,
): Record<string, ManifestEntry> {
  const out: Record<string, ManifestEntry> = {}
  const ids = new Set<string>([...Object.keys(local), ...Object.keys(remote), ...Object.keys(nextMd5)])
  for (const id of ids) {
    const l = local[id]
    const r = remote[id]
    const tombAt = Math.max(l?.deletedAt ?? 0, r?.deletedAt ?? 0)
    const md5 = nextMd5[id]
    if (md5 === null) {
      // 已删:曾有记录才记 tombstone,否则(从未存在)不落条目
      if (!l && !r) continue
      out[id] = { md5: '', mtime: now, deletedAt: tombAt || now }
    } else if (md5 !== undefined) {
      out[id] = { md5, mtime: now, deletedAt: null }
    } else {
      // 计划没覆盖到(理论上不发生):沿用本地,退远端
      const keep = l ?? r
      if (keep) out[id] = keep
    }
  }
  return out
}
