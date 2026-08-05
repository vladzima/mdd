import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder, scrollPastEnd } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import { isTouch } from './layout'
import { livePreview } from './livePreview'
import { useStore } from './store'
import { setEditorView } from './viewRef'

const mono = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace"

const indentCompartment = new Compartment()
const indentConf = (n: number) => [EditorState.tabSize.of(n), indentUnit.of(' '.repeat(n))]

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '650' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '650' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '650' },
  { tag: t.heading, fontWeight: '650' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: mono, fontSize: '0.88em' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'var(--muted)' },
  { tag: t.contentSeparator, color: 'var(--muted)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '16px', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.7' },
  '.cm-content': {
    maxWidth: '44rem',
    margin: '0 auto',
    padding: '4rem 1.5rem',
    caretColor: 'var(--fg)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection)',
  },
  '@media (max-width: 700px)': {
    // desktop's 4rem/1.5rem frame wastes a third of a phone screen
    '.cm-content': { padding: '3.5rem 1rem 2rem' }, // top clears the floating sidebar toggle
  },
})

export function Editor() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const docVersion = useStore((s) => s.docVersion)
  const tabSize = useStore((s) => s.tabSize)

  useEffect(() => {
    viewRef.current?.dispatch({ effects: indentCompartment.reconfigure(indentConf(tabSize)) })
  }, [tabSize])

  useEffect(() => {
    const { doc, onEdit, saveNow } = useStore.getState()
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          indentCompartment.of(indentConf(useStore.getState().tabSize)),
          history(),
          markdown({ base: markdownLanguage }), // GFM: tables, task lists, strikethrough
          EditorView.lineWrapping,
          scrollPastEnd(),
          placeholder('Start writing…'),
          syntaxHighlighting(markdownHighlight),
          livePreview,
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onEdit(u.state.doc.toString())
          }),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                void saveNow()
                return true
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
        ],
      }),
      parent: containerRef.current!,
    })
    viewRef.current = view
    setEditorView(view)
    // Focusing raises the on-screen keyboard, so on touch wait for a real tap.
    if (!isTouch()) view.focus()

    // track which heading section the viewport is in, for the outline highlight
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 80)
        useStore.getState().updateOutlineActive(view.state.doc.lineAt(block.from).number)
      })
    }
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    return () => {
      cancelAnimationFrame(raf)
      view.scrollDOM.removeEventListener('scroll', onScroll)
      viewRef.current = null
      setEditorView(null)
      view.destroy()
    }
  }, [docVersion])

  return <div className="editor" ref={containerRef} />
}
