import type { EditorView } from '@codemirror/view'

// Live reference to the mounted editor, for outline jumps etc.
export let editorView: EditorView | null = null
export function setEditorView(view: EditorView | null) {
  editorView = view
}
