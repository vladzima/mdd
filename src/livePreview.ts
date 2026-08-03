// Live preview: markdown renders styled with syntax marks hidden; the element
// under the cursor/selection reveals its source (writer.computer / Obsidian style).

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { openWikilink, resolveAsset } from './store'

// Elements whose entire source is shown while the selection touches them.
const CONTAINERS = new Set([
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'Emphasis',
  'StrongEmphasis',
  'InlineCode',
  'Strikethrough',
  'Link',
  'Autolink',
  'HorizontalRule',
])

const CODE_NODES = new Set(['InlineCode', 'CodeText', 'FencedCode', 'CodeBlock', 'CodeMark'])
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i
const WIKILINK = /!?\[\[([^[\]|#]+)(#[^[\]|]*)?(\|[^[\]]*)?\]\]/g

class HRWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-hr'
    return el
  }
}

class TaskWidget extends WidgetType {
  readonly checked: boolean
  readonly pos: number
  constructor(checked: boolean, pos: number) {
    super()
    this.checked = checked
    this.pos = pos
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked && other.pos === this.pos
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-task'
    box.checked = this.checked
    box.onmousedown = (e) => {
      e.preventDefault()
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: this.checked ? '[ ]' : '[x]' },
      })
    }
    return box
  }
  ignoreEvent() {
    return true
  }
}

class ImageWidget extends WidgetType {
  readonly src: string
  readonly alt: string
  readonly pos: number
  constructor(src: string, alt: string, pos: number) {
    super()
    this.src = src
    this.alt = alt
    this.pos = pos
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.pos === this.pos
  }
  toDOM(view: EditorView) {
    const img = document.createElement('img')
    img.className = 'cm-image'
    img.alt = this.alt
    img.onload = () => view.requestMeasure()
    img.onmousedown = (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.pos } })
      view.focus()
    }
    void resolveAsset(this.src).then((url) => {
      if (url) img.src = url
      else img.classList.add('cm-image-broken')
    })
    return img
  }
  ignoreEvent() {
    return true
  }
}

class WikilinkWidget extends WidgetType {
  readonly display: string
  readonly target: string
  constructor(display: string, target: string) {
    super()
    this.display = display
    this.target = target
  }
  eq(other: WikilinkWidget) {
    return other.display === this.display && other.target === this.target
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-wikilink'
    el.textContent = this.display
    el.onmousedown = (e) => {
      e.preventDefault()
      void openWikilink(this.target)
    }
    return el
  }
  ignoreEvent() {
    return true
  }
}

// --- inline decorations (ViewPlugin, viewport-scoped) ---

function build(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const doc = view.state.doc
  const ranges = view.state.selection.ranges
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from)
  const hide = (from: number, to: number) => decos.push(Decoration.replace({}).range(from, to))
  // swallow the space that follows a mark ("# ", "> ")
  const hideWithSpace = (from: number, to: number) =>
    hide(from, doc.sliceString(to, to + 1) === ' ' ? to + 1 : to)
  const lineClass = (from: number, to: number, cls: string) => {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      decos.push(Decoration.line({ class: cls }).range(line.from))
      pos = line.to + 1
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        // Block styling stays on while editing; marks reveal when touched.
        if (node.name === 'Blockquote') {
          lineClass(node.from, node.to, 'cm-quote-line')
          return touches(node.from, node.to) ? false : undefined
        }
        if (node.name === 'FencedCode') {
          lineClass(node.from, node.to, 'cm-codeblock')
          return touches(node.from, node.to) ? false : undefined
        }
        if (
          (CONTAINERS.has(node.name) || node.name === 'Image') &&
          touches(node.from, node.to)
        ) {
          return false
        }

        switch (node.name) {
          case 'HeaderMark':
          case 'QuoteMark':
            hideWithSpace(node.from, node.to)
            break
          case 'ListMark':
            decos.push(
              Decoration.mark({ class: 'cm-listmark' }).range(node.from, node.to),
            )
            break
          case 'EmphasisMark':
          case 'CodeMark':
          case 'StrikethroughMark':
          case 'LinkMark':
          case 'LinkTitle':
          case 'CodeInfo':
            hide(node.from, node.to)
            break
          case 'URL': {
            const parent = node.node.parent?.name
            if (parent === 'Link' || parent === 'Image') hide(node.from, node.to)
            break
          }
          case 'Image': {
            const src = doc.sliceString(node.from, node.to)
            const inline = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)/.exec(src) // ![alt](src)
            // ![https://…] / ![img.png] — bracket-only embeds (Midjourney-style exports)
            const bare = inline ? null : /^!\[(\S+)\]$/.exec(src)
            const bareSrc =
              bare && (/^https?:\/\//.test(bare[1]) || IMAGE_EXT.test(bare[1])) ? bare[1] : null
            if (inline || bareSrc) {
              const [imgSrc, alt] = inline ? [inline[2], inline[1]] : [bareSrc!, '']
              decos.push(
                Decoration.replace({ widget: new ImageWidget(imgSrc, alt, node.from) }).range(
                  node.from,
                  node.to,
                ),
              )
              return false
            }
            break // true reference-style image: fall back to mark hiding
          }
          case 'HorizontalRule':
            decos.push(Decoration.replace({ widget: new HRWidget() }).range(node.from, node.to))
            return false
          case 'TaskMarker':
            if (!touches(node.from, node.to)) {
              const checked = doc.sliceString(node.from, node.to).toLowerCase().includes('x')
              const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
              decos.push(
                Decoration.replace({ widget: new TaskWidget(checked, node.from) }).range(
                  node.from,
                  end,
                ),
              )
            }
            break
        }
      },
    })

    // Wikilinks: [[Note]], [[Note|alias]], ![[image.png]] — plain text to the parser.
    const text = doc.sliceString(from, to)
    WIKILINK.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = WIKILINK.exec(text))) {
      const start = from + m.index
      const end = start + m[0].length
      if (touches(start, end)) continue
      if (CODE_NODES.has(syntaxTree(view.state).resolveInner(start, 1).name)) continue
      const target = m[1].trim()
      if (m[0].startsWith('!') && IMAGE_EXT.test(target)) {
        decos.push(
          Decoration.replace({ widget: new ImageWidget(target, target, start) }).range(start, end),
        )
      } else {
        const display = m[3] ? m[3].slice(1).trim() : target + (m[2] ?? '')
        decos.push(
          Decoration.replace({ widget: new WikilinkWidget(display || target, target) }).range(
            start,
            end,
          ),
        )
      }
    }
  }
  return Decoration.set(decos, true)
}

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)

// --- tables (StateField: block decorations may not come from a ViewPlugin) ---

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ponytail: regex-level inline formatting for table cells; nested/escaped syntax
// falls back to literal text
function inlineMd(cell: string): string {
  return esc(cell)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="cm-table-link">$1</span>')
}

class TableWidget extends WidgetType {
  readonly source: string
  readonly from: number
  constructor(source: string, from: number) {
    super()
    this.source = source
    this.from = from
  }
  eq(other: TableWidget) {
    return other.source === this.source && other.from === this.from
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    const rows = this.source
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      // ponytail: naive cell split; escaped \| and | inside inline code will mis-split
      .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    const aligns = (rows[1] ?? []).map((c) =>
      /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : '',
    )
    const table = document.createElement('table')
    table.className = 'cm-table'
    rows.forEach((cells, i) => {
      if (i === 1) return // delimiter row
      const tr = document.createElement('tr')
      cells.forEach((cell, j) => {
        const el = document.createElement(i === 0 ? 'th' : 'td')
        el.innerHTML = inlineMd(cell)
        if (aligns[j]) el.style.textAlign = aligns[j]
        tr.appendChild(el)
      })
      table.appendChild(tr)
    })
    wrap.appendChild(table)
    wrap.onmousedown = (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.from } })
      view.focus()
    }
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

function buildBlocks(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state)
  const ranges = state.selection.ranges
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from)
  tree.iterate({
    enter(node) {
      if (node.name !== 'Table') return
      if (touches(node.from, node.to)) return false
      const startLine = state.doc.lineAt(node.from)
      const endLine = state.doc.lineAt(node.to)
      // block replace must cover whole lines; skip tables nested in quotes etc.
      if (node.from !== startLine.from || node.to !== endLine.to) return false
      decos.push(
        Decoration.replace({
          widget: new TableWidget(state.doc.sliceString(node.from, node.to), node.from),
          block: true,
        }).range(node.from, node.to),
      )
      return false
    },
  })
  return Decoration.set(decos, true)
}

const tablePreview = StateField.define<DecorationSet>({
  create: buildBlocks,
  update(value, tr) {
    if (tr.docChanged || tr.selection) return buildBlocks(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

export const livePreview = [inlinePreview, tablePreview]
