import { NOTE_COLORS, type NoteColor, type NoteFile } from './types'
export type { NoteColor, NoteFile }

/**
 * 笔记 .md 文件 ←→ NoteFile 的序列化(纯函数,三端共用,与 ANotes editor/src/frontmatter.ts 同源)。
 * frontmatter 为固定 schema 的 YAML 子集,v2 共 8 字段
 * (id/title/createdAt/updatedAt/pinned/color/trashedAt/remindAt,固定顺序,全量写入),
 * 不引入 yaml 依赖;损坏字段尽力还原,永不抛错。
 * v1(5 字段)旧文件读取时缺失字段按缺省值处理,首次保存补齐为 v2。
 */

export function createNote(markdown = ''): NoteFile {
  const now = new Date().toISOString()
  return {
    id: makeNoteId(),
    title: '',
    createdAt: now,
    updatedAt: now,
    pinned: false,
    color: 'default',
    trashedAt: null,
    remindAt: null,
    markdown,
  }
}

/** `yyyyMMdd-HHmmss-xxxxx`(随机后缀 36 进制,双端独立生成不冲突)。 */
export function makeNoteId(now = new Date()): string {
  const p = (n: number, w: number): string => String(n).padStart(w, '0')
  const stamp = `${p(now.getFullYear(), 4)}${p(now.getMonth() + 1, 2)}${p(now.getDate(), 2)}-${p(
    now.getHours(),
    2,
  )}${p(now.getMinutes(), 2)}${p(now.getSeconds(), 2)}`
  // 后缀必须恰好 5 位:手机端 idPattern 严格定长,短后缀会被 writeNote 拒绝
  return `${stamp}-${randomSuffix5()}`
}

/** 5 位 36 进制随机后缀(crypto 随机源;三端 Electron 主/渲染进程均可用)。 */
function randomSuffix5(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0].toString(36).slice(0, 5).padEnd(5, '0')
}

/** 序列化为 .md 文件内容(frontmatter + 正文,v2 全量 8 字段)。 */
export function serializeNote(note: NoteFile): string {
  const lines = [
    '---',
    `id: ${note.id}`,
    `title: ${escapeValue(note.title)}`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    `pinned: ${note.pinned}`,
    `color: ${note.color}`,
    `trashedAt: ${note.trashedAt ?? 'null'}`,
    `remindAt: ${note.remindAt ?? 'null'}`,
    '---',
    '',
    note.markdown,
  ]
  return lines.join('\n')
}

/** 解析 .md 文件内容;无 frontmatter 或字段损坏时尽力还原(永不抛错)。 */
export function parseNote(raw: string): NoteFile {
  const { fields, body } = splitFrontmatter(raw)
  const id = typeof fields['id'] === 'string' && fields['id'] ? fields['id'] : makeNoteId()
  const markdown = body
  const title =
    typeof fields['title'] === 'string' && fields['title']
      ? unescapeValue(fields['title'])
      : deriveTitle(markdown)
  return {
    id,
    title,
    createdAt: validIso(fields['createdAt']) ?? new Date().toISOString(),
    updatedAt: validIso(fields['updatedAt']) ?? new Date().toISOString(),
    pinned: fields['pinned'] === true,
    color: parseColor(fields['color']),
    trashedAt: validIsoOrNull(fields['trashedAt']),
    remindAt: validIsoOrNull(fields['remindAt']),
    markdown,
  }
}

// ── 内部 ──────────────────────────────────────────────

function parseColor(v: unknown): NoteColor {
  return typeof v === 'string' && (NOTE_COLORS as readonly string[]).includes(v)
    ? (v as NoteColor)
    : 'default'
}

/** v2 时间字段:null 字面量 / 缺失 / 非法值 → null。 */
function validIsoOrNull(v: unknown): string | null {
  if (v === undefined || v === null || v === 'null' || v === '') return null
  return validIso(v) ?? null
}

function splitFrontmatter(raw: string): {
  fields: Record<string, string | boolean>
  body: string
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { fields: {}, body: raw }
  const fields: Record<string, string | boolean> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (!m) continue
    const [, key, value] = m
    if (value === 'true') fields[key] = true
    else if (value === 'false') fields[key] = false
    else fields[key] = value
  }
  // 规范格式为「--- 空行 正文」:剥掉恰好一个前导换行,保证往返稳定
  return { fields, body: match[2].replace(/^\r?\n/, '') }
}

function validIso(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : v
}

function deriveTitle(markdown: string): string {
  const text = markdownToText(markdown)
  const first = text.split('\n').find((l) => l.trim() !== '')
  const t = (first ?? '').trim().slice(0, 40)
  return t || '未命名笔记'
}

/** 轻量 Markdown → 纯文本(摘要/字数/派生标题用;不做完整 AST)。 */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/gm, '$1')
    .replace(/^(\s*)[-*+]\s+/gm, '$1')
    .replace(/^(\s*)\d+\.\s+/gm, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\r?\n{2,}/g, '\n')
    .trim()
}

/** 摘要:纯文本首行,截断。 */
export function noteExcerpt(markdown: string, max = 60): string {
  const text = markdownToText(markdown).replace(/\n/g, ' ')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 字数:按可见字符计(CJK 每字算一)。 */
export function noteWordCount(markdown: string): number {
  const text = markdownToText(markdown).replace(/\s/g, '')
  return [...text].length
}

/** 全文搜索匹配:标题或正文(剥 Markdown 语法)包含 query(大小写不敏感;空 query 恒 true)。 */
export function matchesNoteQuery(title: string, markdown: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (title.toLowerCase().includes(q)) return true
  return markdownToText(markdown).toLowerCase().includes(q)
}

function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

function unescapeValue(v: string): string {
  return v.replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
}
