import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@amoolink/notes-editor/react'
import { TiptapNoteEditor } from '@amoolink/notes-editor/react'
import { matchesNoteQuery, noteWordCount } from '@amoolink/notes-editor'
import { useDevices, useNotes, useTrashNotes, type NoteListItemView } from '../bridge'
import {
  NoteIcon,
  PhoneIcon,
  PinIcon,
  PlusIcon,
  RefreshIcon,
  SyncIcon,
  TrashIcon,
} from '../components/Icons'
import './Notes.css'

/** 笔记页(M6):左列表 + 右编辑;500ms 防抖自动保存;同步状态条(docs/08 §4)。
 * P1:v2 回收站视图(恢复/彻底删除)与「在手机上打开」直达(docs/01 §3.6)。 */
export default function NotesPage() {
  const { notes, syncState, reload } = useNotes()
  const { trashed, reloadTrash } = useTrashNotes()
  const { devices } = useDevices()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'notes' | 'trash'>('notes')
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }, [])

  // 当前编辑的笔记被同步删除时,清掉选择
  useEffect(() => {
    if (activeId && !notes.some((n) => n.id === activeId)) setActiveId(null)
  }, [notes, activeId])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return notes
    // 全文搜索:标题 + 正文(摘要只是正文前 60 字,长文靠全文;第一条批增量)
    return notes.filter((n) => matchesNoteQuery(n.title, n.markdown, q))
  }, [notes, query])

  const createNote = async (): Promise<void> => {
    try {
      const item = await window.amoolink.createNote()
      reload()
      setActiveId(item.id)
    } catch (err) {
      showToast(`新建失败:${errText(err)}`)
    }
  }

  const syncNow = async (): Promise<void> => {
    try {
      const state = await window.amoolink.syncNotesNow()
      if (state.phase === 'done') showToast(`已同步 ↑${state.up} ↓${state.down}`)
      else if (state.phase === 'error') showToast(`同步失败:${state.message}`)
    } catch (err) {
      showToast(`同步失败:${errText(err)}`)
    }
  }

  const installApp = async (): Promise<void> => {
    const first = devices.find((d) => d.state === 'device')
    if (!first) {
      showToast('没有已连接的手机')
      return
    }
    try {
      const res = await window.amoolink.installNotesApp(first.serial)
      showToast(res.message)
    } catch (err) {
      showToast(`安装失败:${errText(err)}`)
    }
  }

  /** 在手机上打开该笔记(docs/01 §3.6):am start --es noteId → 手机端 __openNote 直达编辑页。 */
  const openOnPhone = async (id: string): Promise<void> => {
    const first = devices.find((d) => d.state === 'device')
    if (!first) {
      showToast('没有已连接的手机')
      return
    }
    try {
      const res = await window.amoolink.openNoteOnPhone(first.serial, id)
      showToast(res.message)
    } catch (err) {
      showToast(`打开失败:${errText(err)}`)
    }
  }

  /** 回收站恢复:trashedAt=null,随下次同步传回手机。 */
  const restoreNote = async (id: string): Promise<void> => {
    try {
      const note = await window.amoolink.restoreNote(id)
      if (note) {
        reload()
        reloadTrash()
        showToast('已恢复(连接手机后同步)')
      }
    } catch (err) {
      showToast(`恢复失败:${errText(err)}`)
    }
  }

  /** 回收站彻底删除:物理删 + tombstone(与列表删除同路径,随同步删除手机端文件)。 */
  const deleteForever = async (id: string): Promise<void> => {
    try {
      await window.amoolink.removeNote(id)
      reload()
      reloadTrash()
      showToast('已彻底删除(连接手机后同步删除)')
    } catch (err) {
      showToast(`删除失败:${errText(err)}`)
    }
  }

  return (
    <section className="page notes-page">
      <header className="page-header">
        <h1 className="page-title">笔记</h1>
        <span className="notes-count num">{notes.length} 条</span>
        <div className="spacer" />
        <SyncStatusBar state={syncState} onSyncNow={() => void syncNow()} />
        <button
          type="button"
          className={`btn btn-sm ${view === 'trash' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => {
            setView(view === 'trash' ? 'notes' : 'trash')
            setActiveId(null) // 回收站笔记不可编辑
          }}
          title="查看回收站(手机端移入回收站的笔记)"
        >
          <TrashIcon size={13} />
          回收站{trashed.length > 0 ? `(${trashed.length})` : ''}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void installApp()} title="把笔记 App 安装到手机">
          装到手机
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void createNote()}>
          <PlusIcon size={14} />
          新建笔记
        </button>
      </header>

      <div className="notes-layout">
        <aside className="notes-list" aria-label={view === 'trash' ? '回收站列表' : '笔记列表'}>
          {view === 'trash' ? (
            trashed.length === 0 ? (
              <div className="notes-list-empty">
                <TrashIcon size={22} />
                <p>回收站是空的;手机端移入回收站的笔记会出现在这里</p>
              </div>
            ) : (
              trashed.map((n) => (
                <TrashRow
                  key={n.id}
                  note={n}
                  onRestore={() => void restoreNote(n.id)}
                  onDeleteForever={() => void deleteForever(n.id)}
                />
              ))
            )
          ) : (
            <>
              <div className="notes-search">
                <input
                  type="search"
                  placeholder="搜索笔记"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {filtered.length === 0 ? (
                <div className="notes-list-empty">
                  <NoteIcon size={22} />
                  <p>{query ? '没有匹配的笔记' : '还没有笔记,点右上角新建'}</p>
                </div>
              ) : (
                filtered.map((n) => (
                  <NoteRow
                    key={n.id}
                    note={n}
                    active={n.id === activeId}
                    onSelect={() => setActiveId(n.id)}
                    onPin={() => {
                      void window.amoolink.pinNote(n.id, !n.pinned).then(reload)
                    }}
                    onOpenOnPhone={() => void openOnPhone(n.id)}
                    onDelete={() => {
                      void window.amoolink.removeNote(n.id).then(() => {
                        reload()
                        showToast('已删除(连接手机后同步删除)')
                      })
                    }}
                  />
                ))
              )}
            </>
          )}
        </aside>

        <div className="notes-editor-pane">
          {activeId ? (
            <NoteEditor
              key={activeId}
              id={activeId}
              onSaved={reload}
              onToast={showToast}
            />
          ) : (
            <div className="notes-editor-empty">
              <span className="notes-editor-empty-icon">
                <NoteIcon size={26} />
              </span>
              <p className="notes-editor-empty-title">选择或新建一条笔记</p>
              <p className="notes-editor-empty-desc">手机连接电脑后自动双向同步(可在设置中关闭)。</p>
            </div>
          )}
        </div>
      </div>

      {toast && <div className="notes-toast">{toast}</div>}
    </section>
  )
}

/** 左列单行:标题+摘要+相对时间+在手机上打开/置顶/删除(hover 显示)。 */
function NoteRow({
  note,
  active,
  onSelect,
  onPin,
  onOpenOnPhone,
  onDelete,
}: {
  note: NoteListItemView
  active: boolean
  onSelect: () => void
  onPin: () => void
  onOpenOnPhone: () => void
  onDelete: () => void
}) {
  return (
    <div className={`note-row${active ? ' active' : ''}`} onClick={onSelect} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect() }}>
      <div className="note-row-main">
        <div className="note-row-title">
          {note.pinned && <PinIcon size={12} className="note-pin-flag" />}
          <span>{note.title || '未命名笔记'}</span>
        </div>
        <p className="note-row-excerpt">{note.excerpt || '空白笔记'}</p>
        <span className="note-row-time num">{relativeTime(note.updatedAt)}</span>
      </div>
      <div className="note-row-actions">
        <button type="button" title="在手机上打开" onClick={(e) => { e.stopPropagation(); onOpenOnPhone() }}>
          <PhoneIcon size={13} />
        </button>
        <button type="button" title={note.pinned ? '取消置顶' : '置顶'} onClick={(e) => { e.stopPropagation(); onPin() }}>
          <PinIcon size={13} className={note.pinned ? 'pinned' : undefined} />
        </button>
        <button type="button" title="删除" onClick={(e) => { e.stopPropagation(); onDelete() }}>
          <TrashIcon size={13} />
        </button>
      </div>
    </div>
  )
}

/** 回收站单行:标题+摘要+删于时间+恢复/彻底删除(hover 显示)。 */
function TrashRow({
  note,
  onRestore,
  onDeleteForever,
}: {
  note: NoteListItemView
  onRestore: () => void
  onDeleteForever: () => void
}) {
  return (
    <div className="note-row trash-row" role="listitem">
      <div className="note-row-main">
        <div className="note-row-title">
          <TrashIcon size={12} className="note-pin-flag" />
          <span>{note.title || '未命名笔记'}</span>
        </div>
        <p className="note-row-excerpt">{note.excerpt || '空白笔记'}</p>
        <span className="note-row-time num">删于 {relativeTime(note.trashedAt ?? note.updatedAt)}</span>
      </div>
      <div className="note-row-actions">
        <button type="button" title="恢复(移出回收站)" onClick={onRestore}>
          <RefreshIcon size={13} />
        </button>
        <button type="button" title="彻底删除(不可恢复)" onClick={onDeleteForever}>
          <TrashIcon size={13} />
        </button>
      </div>
    </div>
  )
}

/** 右编辑区:标题输入 + 工具栏 + Tiptap + 底部字数;500ms 防抖保存。 */
function NoteEditor({
  id,
  onSaved,
  onToast,
}: {
  id: string
  onSaved: () => void
  onToast: (message: string) => void
}) {
  const [title, setTitle] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [, setTick] = useState(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draft = useRef({ title: '', markdown: '' })
  const dirty = useRef(false)
  const hydratedEditor = useRef<Editor | null>(null) // StrictMode 双挂载:按实例守卫,重建实例后重新灌入

  useEffect(() => {
    let disposed = false
    void window.amoolink
      .getNote(id)
      .then((note) => {
        if (disposed || !note) return
        setTitle(note.title)
        setMarkdown(note.markdown)
        setUpdatedAt(note.updatedAt)
        draft.current = { title: note.title, markdown: note.markdown }
        setLoaded(true) // 内容就绪后再挂载 Tiptap(useEditor 仅以初始 content 建档)
      })
      .catch(() => onToast('笔记读取失败'))
    return () => {
      disposed = true
      flushSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const flushSave = (): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!dirty.current) return
    dirty.current = false
    void window.amoolink
      .saveNote({ id, title: draft.current.title, markdown: draft.current.markdown })
      .then((note) => {
        if (note) setUpdatedAt(note.updatedAt)
        onSaved()
      })
      .catch(() => onToast('保存失败'))
  }

  const scheduleSave = (): void => {
    dirty.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSave, 500)
  }

  // 工具栏激活态重绘
  useEffect(() => {
    if (!editor) return
    const rerender = (): void => setTick((t) => t + 1)
    editor.on('transaction', rerender)
    return () => {
      editor.off('transaction', rerender)
    }
  }, [editor])

  // React 环境下 useEditor 的初始 content 不走 markdown 解析:编辑器就绪后显式灌入
  useEffect(() => {
    if (!editor || !loaded) return
    if (hydratedEditor.current === editor) return
    hydratedEditor.current = editor
    editor.commands.setContent(draft.current.markdown, { emitUpdate: false })
  }, [editor, loaded])

  const cmd = (fn: (chain: ReturnType<Editor['chain']>) => void): void => {
    if (!editor) return
    fn(editor.chain().focus())
  }

  const words = noteWordCount(markdown)

  return (
    <div className="note-editor">
      <input
        className="note-title-input"
        placeholder="标题"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          draft.current.title = e.target.value
          scheduleSave()
        }}
      />
      <div className="note-toolbar">
        <ToolbarBtn editor={editor} active={!!editor?.isActive('bold')} title="粗体" onClick={() => cmd((c) => c.toggleBold().run())}><b>B</b></ToolbarBtn>
        <ToolbarBtn editor={editor} active={!!editor?.isActive('italic')} title="斜体" onClick={() => cmd((c) => c.toggleItalic().run())}><i>I</i></ToolbarBtn>
        <ToolbarBtn editor={editor} active={!!editor?.isActive('strike')} title="删除线" onClick={() => cmd((c) => c.toggleStrike().run())}><s>S</s></ToolbarBtn>
        <span className="note-toolbar-sep" />
        <ToolbarBtn editor={editor} active={!!editor?.isActive('heading', { level: 2 })} title="标题" onClick={() => cmd((c) => c.toggleHeading({ level: 2 }).run())}>H2</ToolbarBtn>
        <ToolbarBtn editor={editor} active={!!editor?.isActive('heading', { level: 3 })} title="小标题" onClick={() => cmd((c) => c.toggleHeading({ level: 3 }).run())}>H3</ToolbarBtn>
        <span className="note-toolbar-sep" />
        <ToolbarBtn editor={editor} active={!!editor?.isActive('bulletList')} title="无序列表" onClick={() => cmd((c) => c.toggleBulletList().run())}>•≡</ToolbarBtn>
        <ToolbarBtn editor={editor} active={!!editor?.isActive('orderedList')} title="有序列表" onClick={() => cmd((c) => c.toggleOrderedList().run())}>1≡</ToolbarBtn>
        <ToolbarBtn editor={editor} active={!!editor?.isActive('taskList')} title="待办清单" onClick={() => cmd((c) => c.toggleTaskList().run())}>☑</ToolbarBtn>
        <span className="note-toolbar-sep" />
        <ToolbarBtn editor={editor} active={!!editor?.isActive('blockquote')} title="引用" onClick={() => cmd((c) => c.toggleBlockquote().run())}>❝</ToolbarBtn>
        <ToolbarBtn editor={editor} active={!!editor?.isActive('code')} title="行内代码" onClick={() => cmd((c) => c.toggleCode().run())}>{'</>'}</ToolbarBtn>
      </div>
      <div className="note-editor-body">
        {loaded ? (
          <TiptapNoteEditor
            markdown={markdown}
            onReady={setEditor}
            onMarkdownChange={(md) => {
              setMarkdown(md)
              draft.current.markdown = md
              scheduleSave()
            }}
          />
        ) : (
          <p className="note-editor-loading">加载中…</p>
        )}
      </div>
      <footer className="note-editor-footer num">
        <span>{words} 字</span>
        <span className="spacer" />
        <span>{updatedAt ? `保存于 ${relativeTime(updatedAt)}` : ''}</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => { flushSave(); onToast('已保存') }}>
          保存
        </button>
      </footer>
    </div>
  )
}

function ToolbarBtn({
  editor,
  active,
  title,
  onClick,
  children,
}: {
  editor: Editor | null
  active: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`note-toolbar-btn${active ? ' active' : ''}`}
      title={title}
      disabled={!editor}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function SyncStatusBar({ state, onSyncNow }: { state: ReturnType<typeof useNotes>['syncState']; onSyncNow: () => void }) {
  let label = ''
  let tone = ''
  switch (state.phase) {
    case 'idle':
      label = state.lastSyncAt ? `${relativeTimeMs(state.lastSyncAt)}已同步` : '等待连接手机'
      tone = 'muted'
      break
    case 'scanning':
      label = '正在扫描…'
      tone = 'busy'
      break
    case 'syncing':
      label = `同步中 ↑${state.up} ↓${state.down}`
      tone = 'busy'
      break
    case 'done':
      label = `已同步 ↑${state.up} ↓${state.down}`
      tone = 'ok'
      break
    case 'error':
      label = `同步异常:${state.message}`
      tone = 'error'
      break
  }
  return (
    <span className={`sync-status ${tone}`}>
      <SyncIcon size={13} className={tone === 'busy' ? 'spin' : undefined} />
      <span>{label}</span>
      <button type="button" className="sync-now" title="立即同步" onClick={onSyncNow}>
        <RefreshIcon size={12} />
      </button>
    </span>
  )
}

// ── 工具 ──────────────────────────────────────────────

function relativeTime(iso: string): string {
  return relativeTimeMs(new Date(iso).getTime())
}

function relativeTimeMs(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  const diff = Date.now() - ms
  if (diff < 45_000) return '刚刚 '
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前 `
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前 `
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)} 天前 `
  return new Date(ms).toLocaleDateString('zh-CN')
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
