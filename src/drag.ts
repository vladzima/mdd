// Drag a note or a folder somewhere else in the tree.
//
// Pointer events rather than HTML5 drag-and-drop: the latter does not exist on
// iOS at all, and this app is used from a phone and an iPad. That leaves the two
// gestures having to coexist with the tree's own scrolling, so they start
// differently — a mouse starts dragging as soon as it moves, a finger has to
// press and hold, because a finger that moves straight away meant to scroll.

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from './store'
import { dirOf } from './vault'

export interface DropAt {
  dir: string // folder the item lands in; '' is the vault root
  anchor: string | null // sibling to sit next to; null means "at the end"
  place: 'before' | 'after'
}

const MOUSE_SLOP = 5 // px of travel before a press counts as a drag
const TOUCH_SLOP = 8 // px a finger may wander during the hold before it counts as a scroll
const HOLD_MS = 400

// A folder cannot be dropped into itself or into anything it contains.
export function dropAllowed(path: string, at: DropAt): boolean {
  return at.dir !== path && !at.dir.startsWith(`${path}/`)
}

function dropFrom(x: number, y: number, manual: boolean): DropAt | null {
  const el = document.elementFromPoint(x, y)
  if (el?.closest('[data-nodrop]')) return null
  const row = el?.closest<HTMLElement>('[data-path]')
  if (!row) {
    // the empty space under the tree is the vault root — the way back out of a folder
    return el?.closest('[data-droproot]') ? { dir: '', anchor: null, place: 'after' } : null
  }
  const path = row.dataset.path ?? ''
  // Dropping onto a folder puts the item inside it. Dropping onto a note puts the
  // item in that note's folder, which makes every row a usable target.
  if (row.dataset.kind === 'dir') return { dir: path, anchor: null, place: 'after' }
  const dir = dirOf(path)
  if (!manual) return { dir, anchor: null, place: 'after' }
  const box = row.getBoundingClientRect()
  return { dir, anchor: path, place: y < box.top + box.height / 2 ? 'before' : 'after' }
}

export function startDrag(e: ReactPointerEvent<HTMLElement>, path: string): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const touch = e.pointerType !== 'mouse'
  const startX = e.clientX
  const startY = e.clientY
  let dragging = false
  let hold: ReturnType<typeof setTimeout> | undefined

  const block = (ev: Event) => ev.preventDefault()

  const hover = (x: number, y: number) => {
    const at = dropFrom(x, y, useStore.getState().sort === 'manual')
    useStore.getState().hoverDrag(at && dropAllowed(path, at) ? at : null)
  }

  const begin = (x: number, y: number) => {
    dragging = true
    useStore.getState().beginDrag(path)
    // React registers touchmove passively, so the only way to stop the page
    // scrolling under the finger is a listener added here, non-passively.
    document.addEventListener('touchmove', block, { passive: false })
    hover(x, y)
  }

  const finish = () => {
    clearTimeout(hold)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', onKey)
    document.removeEventListener('touchmove', block)
  }

  const move = (ev: PointerEvent) => {
    const travelled = Math.hypot(ev.clientX - startX, ev.clientY - startY)
    if (!dragging) {
      if (touch) {
        if (travelled > TOUCH_SLOP) finish() // moved before the hold elapsed: a scroll
      } else if (travelled > MOUSE_SLOP) {
        begin(ev.clientX, ev.clientY)
      }
      return
    }
    ev.preventDefault()
    hover(ev.clientX, ev.clientY)
  }

  const cancel = () => {
    finish()
    if (dragging) useStore.getState().endDrag()
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cancel()
  }

  const up = () => {
    const { drag, dropAt } = useStore.getState()
    finish()
    if (!dragging) return // a plain click: leave it to open the note
    // The click that follows the release would otherwise open whatever was
    // dropped onto. It fires before any timeout, so this always outlives it.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation()
      ev.preventDefault()
    }
    window.addEventListener('click', swallow, true)
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    useStore.getState().endDrag()
    if (drag && dropAt) void useStore.getState().applyDrop(drag, dropAt)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', onKey)
  if (touch) hold = setTimeout(() => begin(startX, startY), HOLD_MS)
}
