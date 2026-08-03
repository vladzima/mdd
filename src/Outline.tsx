import { EditorView } from '@codemirror/view'
import { useStore } from './store'
import { editorView } from './viewRef'

export function Outline() {
  const outline = useStore((s) => s.outline)
  const outlineActive = useStore((s) => s.outlineActive)
  const outlineWidth = useStore((s) => s.outlineWidth)
  const setOutlineWidth = useStore((s) => s.setOutlineWidth)
  if (outline.length === 0) return null

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const move = (ev: MouseEvent) =>
      setOutlineWidth(Math.min(420, Math.max(160, window.innerWidth - ev.clientX)))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <aside className="outline" style={{ width: outlineWidth }}>
      <div className="resizer left" onMouseDown={startResize} />
      <div className="section-label">Outline</div>
      {outline.map((h, i) => (
        <div
          key={`${h.line}-${i}`}
          className={`outline-item${h.line === outlineActive ? ' active' : ''}`}
          style={{ paddingLeft: `${10 + (h.level - 1) * 12}px` }}
          title={h.text}
          onClick={() => jumpToLine(h.line)}
        >
          {h.text}
        </div>
      ))}
    </aside>
  )
}

function jumpToLine(n: number) {
  const view = editorView
  if (!view) return
  const line = view.state.doc.line(Math.min(n, view.state.doc.lines))
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 80 }),
  })
  view.focus()
}
