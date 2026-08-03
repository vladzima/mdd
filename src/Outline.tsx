import { EditorView } from '@codemirror/view'
import { startResize } from './resize'
import { useStore } from './store'
import { editorView } from './viewRef'

export function Outline() {
  const outline = useStore((s) => s.outline)
  const outlineActive = useStore((s) => s.outlineActive)
  const outlineWidth = useStore((s) => s.outlineWidth)
  const setOutlineWidth = useStore((s) => s.setOutlineWidth)
  if (outline.length === 0) return null

  return (
    <aside className="outline" style={{ width: outlineWidth }}>
      <div
        className="resizer left"
        onPointerDown={(e) =>
          startResize(e, (x) => setOutlineWidth(Math.min(420, Math.max(160, innerWidth - x))))
        }
      />
      {/* scrolling lives on the inner element: an overflow container would clip
          the resize strip that hangs outside the pane's left edge */}
      <div className="outline-scroll">
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
      </div>
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
