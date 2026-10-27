import type { NoteFile } from './types'
export type { NoteFile }

/**
 * 笔记 .md 文件 ←→ NoteFile 的序列化(纯函数,三端共用)。
 * frontmatter 为固定 schema 的 YAML 子集(id/title/createdAt/updatedAt/pinned),
 * 不引入 yaml 依赖;损坏字段尽力还原,永不抛错。
 */

export function createNote(markdown = ''): NoteFile {
  const now = new Date().toISOString()
  return { id: makeNoteId(), title: '', createdAt: now, updatedAt: now, pinned: false, markdown }
}

/** `yyyyMMdd-HHmmss-xxxxx`(随机后缀 36 进制,双端独立生成不冲突)。 */
export function makeNoteId(now = new Date()): string {
  const p = (n: number, w: number): string => String(n).padStart(w, '0')
  const stamp = `${p(now.getFullYear(), 4)}${p(now.getMonth() + 1, 2)}${p(now.getDate(), 2)}-${p(
    now.getHours(),
    2,
  )}${p(now.getMinutes(), 2)}${p(now.getSeconds(), 2)}`
  const rand = Math.random().toString(36).slice(2, 7)
  return `${stamp}-${rand}`
}

/** 序列化为 .md 文件内容(frontmatter + 正文)。 */
export function serializeNote(note: NoteFile): string {
  const lines = [
    '---',
    `id: ${note.id}`,
    `title: ${escapeValue(note.title)}`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    `pinned: ${note.pinned}`,
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
    markdown,
  }
}

// ── 内部 ──────────────────────────────────────────────

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

function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

function unescapeValue(v: string): string {
  return v.replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
}
