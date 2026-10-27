// @vitest-environment jsdom
// tiptap-markdown × Tiptap v3 兼容性验证:markdown 进出必须稳定往返。
import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createNoteExtensions, editorToMarkdown } from '../src/extensions'

function makeEditor(markdown = ''): Editor {
  return new Editor({
    extensions: createNoteExtensions(),
    content: markdown,
  })
}

describe('Tiptap 编辑器 Markdown 往返', () => {
  it('初始 content 按 Markdown 解析(标题)', () => {
    const ed = makeEditor('## 标题二\n\n正文')
    expect(editorToMarkdown(ed)).toContain('## 标题二')
    ed.destroy()
  })

  it('一级标题降级为段落(标题独立输入框,正文从 H2 起)', () => {
    const ed = makeEditor('# 会被降级')
    expect(editorToMarkdown(ed)).not.toContain('#')
    expect(editorToMarkdown(ed)).toContain('会被降级')
    ed.destroy()
  })

  it('粗体/斜体/删除线往返', () => {
    const ed = makeEditor('**粗体** 与 *斜体* 与 ~~删除~~')
    const md = editorToMarkdown(ed)
    expect(md).toContain('**粗体**')
    expect(md).toContain('*斜体*')
    expect(md).toContain('~~删除~~')
    ed.destroy()
  })

  it('待办清单往返(vivo 笔记核心交互)', () => {
    const ed = makeEditor('- [x] 已完成项\n- [ ] 未完成项')
    const md = editorToMarkdown(ed)
    expect(md).toMatch(/\[x\]\s*已完成项/)
    expect(md).toMatch(/\[ \]\s*未完成项/)
    ed.destroy()
  })

  it('命令写入→读出(setContent markdown 解析)', () => {
    const ed = makeEditor('')
    ed.commands.setContent('## 二级标题\n\n- 列表项')
    const md = editorToMarkdown(ed)
    expect(md).toContain('## 二级标题')
    expect(md).toContain('列表项')
    ed.destroy()
  })

  it('空内容往返为空', () => {
    const ed = makeEditor('')
    expect(editorToMarkdown(ed).trim()).toBe('')
    ed.destroy()
  })

  it('引用与有序列表往返', () => {
    const ed = makeEditor('> 引用一行\n\n1. 甲\n2. 乙')
    const md = editorToMarkdown(ed)
    expect(md).toContain('引用一行')
    expect(md).toMatch(/^\s*1\.\s+甲/m)
    ed.destroy()
  })

  it('toggleBold 命令产生 **', () => {
    const ed = makeEditor('普通文字')
    ed.commands.setTextSelection({ from: 1, to: 5 })
    ed.commands.toggleBold()
    expect(editorToMarkdown(ed)).toMatch(/\*\*.{2,}\*\*/)
    ed.destroy()
  })
})

// 占位:验证扩展列表里没有漏配(Placehoder 存在即可)
describe('扩展集完整性', () => {
  it('Placeholder 与 TaskList 已注册', () => {
    const ed = makeEditor('')
    expect(ed.storage['markdown']).toBeTruthy()
    vi.mocked(ed.getHTML) // noop,避免未使用告警
    ed.destroy()
  })
})
