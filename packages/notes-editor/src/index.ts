export type {
  NoteMeta,
  NoteFile,
  NoteColor,
  NoteListItem,
  ManifestEntry,
  Manifest,
  SyncState,
} from './types'
export {
  createNote,
  makeNoteId,
  parseNote,
  serializeNote,
  markdownToText,
  matchesNoteQuery,
  noteExcerpt,
  noteWordCount,
} from './frontmatter'
export { createNoteExtensions, editorToMarkdown } from './extensions'
export { planSync, mergeManifests, type SideState, type SyncAction } from './sync-plan'
