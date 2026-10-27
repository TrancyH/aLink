import { describe, expect, it } from 'vitest'
import {
  createNote,
  makeNoteId,
  markdownToText,
  noteExcerpt,
  noteWordCount,
  parseNote,
  serializeNote,
} from '../src/frontmatter'

describe('makeNoteId', () => {
  it('格式为 yyyyMMdd-HHmmss-xxxxx 且两次生成不同', () => {
    const a = makeNoteId(new Date('2026-10-27T06:32:01'))
    const b = makeNoteId(new Date('2026-10-27T06:32:01'))
    expect(a).toMatch(/^20261027-063201-[a-z0-9]{5}$/)
    expect(a).not.toBe(b)
  })
})

describe('serializeNote / parseNote 往返', () => {
  it('完整字段往返无损', () => {
    const note = {
      id: '20261027-100000-abcde',
      title: '会议纪要\n第二行',
      createdAt: '2026-10-27T02:00:00.000Z',
      updatedAt: '2026-10-27T03:00:00.000Z',
      pinned: true,
      markdown: '# 标题\n\n正文 **加粗** 与 `代码`。',
    }
    const raw = serializeNote(note)
    expect(raw).toContain('id: 20261027-100000-abcde')
    expect(raw).toContain('pinned: true')
    expect(parseNote(raw)).toEqual(note)
  })

  it('空正文 / 空标题', () => {
    const note = createNote('')
    const back = parseNote(serializeNote(note))
    expect(back.markdown).toBe('')
    expect(back.id).toBe(note.id)
    expect(back.pinned).toBe(false)
  })

  it('正文包含 frontmatter 形态文本时不误切', () => {
    const note = createNote('---\nid: fake\n---\n这是正文里的假 frontmatter')
    const back = parseNote(serializeNote(note))
    expect(back.id).toBe(note.id)
    expect(back.markdown).toBe(note.markdown)
  })

  it('无 frontmatter 的裸 Markdown 尽力还原并派生标题', () => {
    const note = parseNote('你好世界\n\n第二段')
    expect(note.markdown).toBe('你好世界\n\n第二段')
    expect(note.title).toBe('你好世界')
    expect(note.pinned).toBe(false)
  })

  it('损坏字段(坏日期/缺字段)不抛错', () => {
    const note = parseNote('---\nid: x1\ntitle: T\ncreatedAt: not-a-date\n---\nbody')
    expect(note.id).toBe('x1')
    expect(note.title).toBe('T')
    expect(note.createdAt).not.toBe('not-a-date')
    expect(Number.isNaN(new Date(note.createdAt).getTime())).toBe(false)
  })

  it('pinned 非法值按 false', () => {
    const note = parseNote('---\nid: x2\npinned: maybe\n---\n')
    expect(note.pinned).toBe(false)
  })
})

describe('markdownToText / 摘要 / 字数', () => {
  it('剥离标题/列表/强调/代码/链接', () => {
    const md = '## 标题\n\n- **粗体** 项\n- [x] 待办项\n\n> 引用\n\n[链接](https://a.b)\n\n`code`'
    expect(markdownToText(md)).toBe('标题\n粗体 项\n待办项\n引用\n链接\ncode')
  })

  it('代码块整体移除', () => {
    expect(markdownToText('前\n```\nsecret\n```\n后')).toBe('前\n后')
  })

  it('excerpt 截断加省略号', () => {
    expect(noteExcerpt('一二三四五', 3)).toBe('一二三…')
    expect(noteExcerpt('一二三', 3)).toBe('一二三')
  })

  it('字数按可见字符,CJK 与英文一致', () => {
    expect(noteWordCount('hello 世界')).toBe(7) // h e l l o 世 界
    expect(noteWordCount('')).toBe(0)
  })
})

describe('派生标题', () => {
  it('正文首行为空行时跳过', () => {
    const note = parseNote('---\nid: x3\n---\n\n\n真正的标题\n')
    expect(note.title).toBe('真正的标题')
  })
  it('全空正文回退「未命名笔记」', () => {
    expect(parseNote('---\nid: x4\n---\n\n\n').title).toBe('未命名笔记')
  })
  it('超长标题截断 40 字', () => {
    const long = '字'.repeat(50)
    const note = parseNote(`---\nid: x5\n---\n${long}`)
    expect(note.title.length).toBe(40)
  })
})
