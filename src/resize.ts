import type { PointerEvent as ReactPointerEvent } from 'react'

// Drag-to-resize for both sidebars. Pointer events, not mouse events: a finger
// drag on iPadOS fires no mousemove at all, so the mouse-only version resized
// only when a mouse was attached.
export function startResize(
  e: ReactPointerEvent<HTMLElement>,
  apply: (clientX: number) => void,
): void {
  e.preventDefault()
  const el = e.currentTarget
  el.setPointerCapture(e.pointerId) // keeps events coming once the finger leaves the strip
  const move = (ev: PointerEvent) => apply(ev.clientX)
  const end = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}
