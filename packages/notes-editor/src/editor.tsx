import { useEffect } from 'react'
import { EditorProvider, useEditor, type Editor } from '@tiptap/react'
import { EditorContent } from '@tiptap/react'
import { createNoteExtensions, editorToMarkdown } from './extensions'

export interface TiptapNoteEditorProps {
  /** 初始 Markdown(以 note.id 为 key 重建组件,不做受控同步)。 */
  markdown: string
  /** 正文变更(已被 500ms 防抖的消费方再处理)。 */
  onMarkdownChange?: (markdown: string) => void
  /** 把 Editor 实例交给页面渲染工具栏;卸载时回传 null。 */
  onReady?: (editor: Editor | null) => void
  placeholder?: string
}

/** 桌面端富文本编辑器(所见即所得,vivo 风)。 */
export function TiptapNoteEditor(props: TiptapNoteEditorProps): React.ReactNode {
  const editor = useEditor({
    extensions: createNoteExtensions(),
    content: props.markdown,
    editorProps: { attributes: { class: 'notes-prose' } },
    onUpdate: ({ editor: ed }) => props.onMarkdownChange?.(editorToMarkdown(ed)),
  })

  useEffect(() => {
    props.onReady?.(editor ?? null)
    return () => props.onReady?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  return <EditorContent editor={editor} className="notes-editor-content" />
}

export { EditorProvider, createNoteExtensions, editorToMarkdown }
export type { Editor }
