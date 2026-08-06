// The one dialog on screen. Its promise API lives in dialog.ts.

import { useEffect, useId, useRef, useState } from 'react'
import { returnFocus, useDialog, type Request } from './dialog'
import { useLingering } from './motion'

const LABEL: Record<Request['kind'], string> = {
  confirm: 'Delete',
  prompt: 'Rename',
  alert: 'OK',
}

// Long enough for --dur-modal-out to finish before React takes the node away.
const EXIT_MS = 160

export function DialogHost() {
  const current = useDialog((s) => s.request)
  const [request, closing] = useLingering(current, EXIT_MS)
  const [text, setText] = useState('')
  const [shown, setShown] = useState<Request | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const messageId = useId()

  // Seeded during render, not in an effect: an effect runs after the paint, so
  // the rename field would appear empty for a frame and then fill itself in.
  if (request !== shown) {
    setShown(request)
    setText(request?.kind === 'prompt' ? request.value : '')
  }

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation() // closes this, not the note behind it
        current.resolve(null as never)
        return
      }
      if (e.key !== 'Tab') return
      // Nothing behind the dialog is reachable while it is open.
      const stops = panel.current?.querySelectorAll<HTMLElement>('button, input')
      if (!stops?.length) return
      const edge = e.shiftKey ? stops[0] : stops[stops.length - 1]
      if (document.activeElement === edge) {
        e.preventDefault()
        ;(e.shiftKey ? stops[stops.length - 1] : stops[0]).focus()
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      // back where it came from, so answering a dialog does not dump a keyboard
      // user at the top of the page
      returnFocus()
    }
  }, [current])

  if (!request) return null

  const dismiss = () => request.resolve(null as never)
  const submit = () => {
    if (request.kind === 'prompt') request.resolve(text.trim() || null)
    else if (request.kind === 'confirm') request.resolve(true)
    else request.resolve()
  }

  return (
    <div className={`dialog-overlay${closing ? ' is-closing' : ''}`} onMouseDown={dismiss}>
      <div
        ref={panel}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={messageId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-message" id={messageId}>
          {request.message}
        </div>
        {request.kind === 'prompt' && (
          <input
            className="text-input"
            value={text}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        )}
        <div className="dialog-actions">
          {request.kind !== 'alert' && (
            <button className="btn" onClick={dismiss}>
              Cancel
            </button>
          )}
          {/* the text field wants the focus when there is one */}
          <button className="btn primary" autoFocus={request.kind !== 'prompt'} onClick={submit}>
            {request.kind === 'confirm' ? request.confirmLabel : LABEL[request.kind]}
          </button>
        </div>
      </div>
    </div>
  )
}
