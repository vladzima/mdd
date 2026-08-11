import { useEffect, useMemo, useRef, useState } from 'react'
import ChevronRight from 'reicon-react/icons/ChevronRight'
import CloseCircle from 'reicon-react/icons/CloseCircle'
import FolderAdd from 'reicon-react/icons/FolderAdd'
import NoteAdd from 'reicon-react/icons/NoteAdd'
import Pen from 'reicon-react/icons/Pen'
import PinTack from 'reicon-react/icons/PinTack'
import Thumbtack2 from 'reicon-react/icons/Thumbtack2'
import SearchIcon from 'reicon-react/icons/Search'
import Settings2 from 'reicon-react/icons/Settings2'
import SidebarLeft from 'reicon-react/icons/SidebarLeft'
import Sort from 'reicon-react/icons/Sort'
import SortAlpha from 'reicon-react/icons/SortAlpha'
import SortTime from 'reicon-react/icons/SortTime'
import SortV from 'reicon-react/icons/SortV'
import Trash2 from 'reicon-react/icons/Trash2'
import { ask, askText, tell } from './dialog'
import { PIN_DIR, startDrag } from './drag'
import { isNarrow } from './layout'
import { useLingering } from './motion'
import { startResize } from './resize'
import { LIMIT, MIN_TEXT, searchNames, searchText, type Hit } from './search'
import { sortTree, type Sort as SortMode } from './sort'
import { useStore } from './store'
import { dirOf, type TreeNode } from './vault'

const say = (err: unknown) => void tell(err)

export function Sidebar({ closing }: { closing?: boolean }) {
  const vaultName = useStore((s) => s.vaultName)
  const tree = useStore((s) => s.tree)
  const recents = useStore((s) => s.recents)
  const pinned = useStore((s) => s.pinned)
  const sort = useStore((s) => s.sort)
  const manualOrder = useStore((s) => s.manualOrder)
  const createFile = useStore((s) => s.createFile)
  const createDir = useStore((s) => s.createDir)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)
  const drag = useStore((s) => s.drag)
  const atRoot = useStore((s) => s.dropAt?.dir === '' && s.dropAt.anchor === null)

  const sorted = useMemo(() => sortTree(tree, sort, manualOrder), [tree, sort, manualOrder])

  const [query, setQuery] = useState('')
  const q = query.trim()
  const nameHits = useMemo(() => searchNames(tree, q), [tree, q])
  const [textHits, setTextHits] = useState<Hit[]>([])
  const [scanning, setScanning] = useState(false)
  const hits = useMemo(() => [...nameHits, ...textHits].slice(0, LIMIT), [nameHits, textHits])

  // Names are already in hand; the text scan has files to read, so it waits for a
  // pause in the typing and lands underneath them.
  useEffect(() => {
    setTextHits([])
    const vault = useStore.getState().vault
    if (!vault || q.length < MIN_TEXT) return
    const skip = new Set(nameHits.map((h) => h.path))
    let alive = true
    const timer = setTimeout(() => {
      setScanning(true)
      void searchText(vault, tree, q, skip, () => alive)
        .then((found) => {
          if (alive) setTextHits(found)
        })
        .finally(() => {
          if (alive) setScanning(false)
        })
    }, 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q, tree, nameHits])

  const existingPaths = useMemo(() => {
    const paths = new Set<string>()
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'file') paths.add(n.path)
        else collect(n.children ?? [])
      }
    }
    collect(tree)
    return paths
  }, [tree])
  // A pinned note already has one-tap access a row above, so listing it under
  // Recent would waste one of the five slots on a duplicate. Display-only:
  // unpin, and the note resurfaces here if it is still fresh.
  const recentShown = recents
    .filter((p) => existingPaths.has(p) && !pinned.includes(p))
    .slice(0, 5)
  // A pin outlives its note being deleted or renamed elsewhere; only show what exists.
  const pinnedShown = pinned.filter((p) => existingPaths.has(p))

  return (
    <aside
      className={`sidebar${drag ? ' dragging' : ''}${closing ? ' is-closing' : ''}`}
      style={{ width: sidebarWidth }}
    >
      <div className="sidebar-header">
        <button
          className="vault-name"
          title="Switch vault"
          onClick={() => void useStore.getState().closeVault()}
        >
          {vaultName}
        </button>
        <button className="icon-btn" title="New note" aria-label="New note" onClick={() => void createFile()}>
          <NoteAdd size={16} />
        </button>
        <button className="icon-btn" title="New folder" aria-label="New folder" onClick={() => void createDir().catch(say)}>
          <FolderAdd size={16} />
        </button>
        <SortMenu />
        <button
          className="icon-btn"
          title="Settings"
          onClick={() => useStore.getState().setSettingsOpen(true)}
        >
          <Settings2 size={16} />
        </button>
        <button
          className="icon-btn"
          title="Hide sidebar (⌘\)"
          aria-label="Hide sidebar"
          onClick={toggleSidebar}
        >
          <SidebarLeft size={16} />
        </button>
      </div>
      <div className="search-box">
        <SearchIcon size={14} aria-hidden="true" />
        <input
          className="search-input"
          placeholder="Search"
          title="Search notes (⌘K)"
          aria-label="Search notes"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('')
              e.currentTarget.blur()
            }
            // straight from the field into the results, without a detour by Tab
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              document.querySelector<HTMLElement>('.tree .row[data-path]')?.focus()
            }
          }}
        />
        {query && (
          <button
            className="icon-btn"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <CloseCircle size={14} />
          </button>
        )}
      </div>
      {/* the empty space below the tree is the drop target for "move back to the
          vault root" — without it there is no way out of a folder by drag */}
      <nav
        className={`tree${atRoot ? ' drop-into' : ''}`}
        role="tree"
        aria-label="Notes"
        tabIndex={0}
        onFocus={enterTree}
        onKeyDown={onTreeKey}
        data-droproot
      >
        {q ? (
          <Results hits={hits} query={q} scanning={scanning} />
        ) : (
          <Tree sorted={sorted} recentShown={recentShown} pinnedShown={pinnedShown} />
        )}
      </nav>
      <div
        className="resizer"
        onPointerDown={(e) => startResize(e, (x) => setSidebarWidth(Math.min(420, Math.max(180, x))))}
      />
    </aside>
  )
}

function Tree({
  sorted,
  recentShown,
  pinnedShown,
}: {
  sorted: TreeNode[]
  recentShown: string[]
  pinnedShown: string[]
}) {
  const baseName = (path: string) => path.split('/').pop()!.replace(/\.md$/, '')
  return (
    <>
      {pinnedShown.length > 0 && (
        // Pinned rows reorder among themselves by drag; to a tree drag the
        // section is off-limits, like Recent.
        <div data-nodrop>
          <div className="section-label">Pinned</div>
          {pinnedShown.map((path) => (
            <FileRow key={path} path={path} name={baseName(path)} indent={10} pin />
          ))}
        </div>
      )}
      {recentShown.length > 0 && (
        // Recent is a shortcut list, not a place in the tree — dropping onto it
        // would have to mean something, and nothing it could mean is useful.
        <div data-nodrop>
          <div className="section-label">Recent</div>
          {recentShown.map((path) => (
            <FileRow key={path} path={path} name={baseName(path)} indent={10} recent />
          ))}
        </div>
      )}
      {(pinnedShown.length > 0 || recentShown.length > 0) && (
        <div className="section-label">Notes</div>
      )}
      {sorted.map((node) => (
        <Node key={node.path} node={node} depth={0} />
      ))}
    </>
  )
}

function Results({ hits, query, scanning }: { hits: Hit[]; query: string; scanning: boolean }) {
  const count = hits.length
  return (
    // Results are a lookup, not a place in the vault: nothing can be dropped here.
    <div data-nodrop>
      <div className="section-label">
        {count
          ? `${count}${count === LIMIT ? '+' : ''} ${count === 1 ? 'result' : 'results'}`
          : scanning
            ? 'Searching…'
            : 'No matches'}
      </div>
      {hits.map((hit) => (
        <HitRow key={hit.path} hit={hit} len={query.length} />
      ))}
      {query.length < MIN_TEXT && (
        <div className="menu-note">Two letters or more also searches inside notes.</div>
      )}
      {scanning && count > 0 && <div className="menu-note">Still reading notes…</div>}
    </div>
  )
}

// A result carries no rename or delete: it is a way to reach a note, and the row
// is already two lines tall. `data-path` is what the tree's arrow keys walk.
function HitRow({ hit, len }: { hit: Hit; len: number }) {
  const activePath = useStore((s) => s.activePath)
  const openFile = useStore((s) => s.openFile)
  const active = activePath === hit.path
  const dir = dirOf(hit.path)

  return (
    <div
      className={`row file hit${active ? ' active' : ''}`}
      data-path={hit.path}
      data-kind="file"
      role="treeitem"
      aria-selected={active}
      aria-label={hit.name}
      tabIndex={-1}
      onClick={() => void openFile(hit.path)}
    >
      <span className="hit-text">
        <span className="row-name">{hit.line ? hit.name : mark(hit.name, hit.at, len)}</span>
        {/* the folder stands in when the name matched: two notes can share a name */}
        {(hit.line ?? dir) && (
          <span className="hit-line">{hit.line ? mark(hit.line, hit.at, len) : dir}</span>
        )}
      </span>
    </div>
  )
}

function mark(text: string, at: number, len: number) {
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + len)}</mark>
      {text.slice(at + len)}
    </>
  )
}

// One tab stop for the whole tree, then the arrow keys move within it — the
// alternative, a tab stop per note, buries whatever comes after the sidebar.
function enterTree(e: React.FocusEvent<HTMLElement>) {
  if (e.target !== e.currentTarget) return // bubbled up from a row or a button
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.row[data-path]')]
  ;(rows.find((r) => r.classList.contains('active')) ?? rows[0])?.focus()
}

function onTreeKey(e: React.KeyboardEvent<HTMLElement>) {
  if (e.target instanceof HTMLInputElement) return // renaming; the field owns the keys
  const row = (e.target as HTMLElement).closest<HTMLElement>('.row[data-path]')
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.row[data-path]')]
  const i = row ? rows.indexOf(row) : -1
  const go = (next: number) => {
    e.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus()
  }

  switch (e.key) {
    case 'ArrowDown':
      return go(i + 1)
    case 'ArrowUp':
      return go(i - 1)
    case 'Home':
      return go(0)
    case 'End':
      return go(rows.length - 1)
    case 'ArrowRight':
    case 'ArrowLeft': {
      if (!row || row.dataset.kind !== 'dir') return
      const collapsed = row.getAttribute('aria-expanded') === 'false'
      // right opens a shut folder then steps inside it; left closes, or steps out
      if (e.key === 'ArrowRight' ? collapsed : !collapsed) {
        e.preventDefault()
        useStore.getState().toggleDir(row.dataset.path ?? '')
        return
      }
      return go(e.key === 'ArrowRight' ? i + 1 : i - 1)
    }
    case 'Enter':
    case ' ':
      // Only when the row itself has the focus: the rename and delete buttons
      // sit inside it and activate themselves.
      if (!row || e.target !== row) return
      e.preventDefault()
      row.click()
      return
    default:
  }
}

const SORT_LABELS: Record<SortMode, string> = {
  name: 'Name',
  date: 'Date edited',
  manual: 'Manual',
}

const SORT_ICONS: Record<SortMode, typeof SortAlpha> = {
  name: SortAlpha,
  date: SortTime,
  manual: SortV,
}

function SortMenu() {
  const sort = useStore((s) => s.sort)
  const setSort = useStore((s) => s.setSort)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  // held open a moment past the close so the scale-down can play
  const [mounted, closing] = useLingering(open || null, 120)

  const close = (toTrigger = true) => {
    setOpen(false)
    if (toTrigger) trigger.current?.focus() // where the keyboard user came from
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // capture, so a click on a tree row closes the menu before it opens a note
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Arrow keys walk the options, as in any menu; the items are real buttons, so
  // Enter and Space already work.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(box.current?.querySelectorAll<HTMLElement>('.menu-item') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus()
  }

  return (
    <div className="sort-menu" ref={box} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        className="icon-btn"
        title={`Sort: ${SORT_LABELS[sort]}`}
        aria-label={`Sort notes, currently ${SORT_LABELS[sort].toLowerCase()}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Sort size={16} />
      </button>
      {mounted && (
        <div className={`menu${closing ? ' is-closing' : ''}`} role="menu">
          {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => {
            const Icon = SORT_ICONS[mode]
            return (
              <button
                key={mode}
                className={`menu-item${sort === mode ? ' selected' : ''}`}
                role="menuitemradio"
                aria-checked={sort === mode}
                onClick={() => {
                  setSort(mode)
                  close()
                }}
              >
                <Icon size={15} aria-hidden="true" />
                {SORT_LABELS[mode]}
              </button>
            )
          })}
          <div className="menu-note">Drag notes onto a folder to move them.</div>
        </div>
      )}
    </div>
  )
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  if (node.kind === 'dir') return <DirRow node={node} depth={depth} />
  return <FileRow path={node.path} name={node.name} indent={10 + depth * 14} />
}

function DirRow({ node, depth }: { node: TreeNode; depth: number }) {
  const createFile = useStore((s) => s.createFile)
  const createDir = useStore((s) => s.createDir)
  const deleteDir = useStore((s) => s.deleteDir)
  const collapsed = useStore((s) => s.collapsedDirs.has(node.path))
  const toggleDir = useStore((s) => s.toggleDir)
  const dragging = useStore((s) => s.drag === node.path)
  const into = useStore((s) => s.dropAt?.dir === node.path && s.dropAt.anchor === null)
  const insert = useInsertLine(node.path)

  return (
    <div>
      {insert === 'before' && <DropLine indent={10 + depth * 14} />}
      <div
        className={`row dir${into ? ' drop-into' : ''}${dragging ? ' is-dragging' : ''}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        data-path={node.path}
        data-kind="dir"
        role="treeitem"
        aria-expanded={!collapsed}
        aria-label={node.name}
        tabIndex={-1}
        onPointerDown={(e) => startDrag(e, node.path)}
        onClick={() => toggleDir(node.path)}
      >
        <span className={`chevron${collapsed ? ' collapsed' : ''}`}>
          <ChevronRight size={12} />
        </span>
        <RowName row={node.path} path={node.path} name={node.name} kind="dir" />
        <span className="row-actions">
          <button
            className="icon-btn"
            title="New note here" aria-label="New note in this folder"
            onClick={(e) => {
              e.stopPropagation()
              void createFile(node.path)
            }}
          >
            <NoteAdd size={14} />
          </button>
          <button
            className="icon-btn"
            title="New folder here" aria-label="New folder in this folder"
            onClick={(e) => {
              e.stopPropagation()
              void createDir(node.path).catch(say)
            }}
          >
            <FolderAdd size={14} />
          </button>
          <button
            className="icon-btn"
            title="Rename"
            aria-label={`Rename folder ${node.name}`}
            onClick={(e) => {
              e.stopPropagation()
              startRename(node.path, node.path, node.name, 'dir')
            }}
          >
            <Pen size={14} />
          </button>
          <button
            className="icon-btn"
            title="Delete folder"
            aria-label={`Delete folder ${node.name}`}
            onClick={(e) => {
              e.stopPropagation()
              void ask(`Delete folder “${node.name}”?`)
                .then((ok) => {
                  if (ok) return deleteDir(node.path)
                })
                .catch(say)
            }}
          >
            <Trash2 size={14} />
          </button>
        </span>
      </div>
      {!collapsed &&
        node.children!.map((child) => <Node key={child.path} node={child} depth={depth + 1} />)}
      {insert === 'after' && <DropLine indent={10 + depth * 14} />}
    </div>
  )
}

// Shared by the tree, the Recent list, and the Pinned section — Recent used to
// render a bare name, which left a freshly created note with no way to rename it.
function FileRow({
  path,
  name,
  indent,
  recent,
  pin,
}: {
  path: string
  name: string
  indent: number
  recent?: boolean
  pin?: boolean
}) {
  const activePath = useStore((s) => s.activePath)
  const openFile = useStore((s) => s.openFile)
  const deleteFile = useStore((s) => s.deleteFile)
  const togglePin = useStore((s) => s.togglePin)
  const isPinned = useStore((s) => s.pinned.includes(path))
  const dragging = useStore((s) => s.drag === path)
  // Recent is a shortcut list, not a place in the tree: reordering or reparenting
  // there would be meaningless, so it is not draggable and shows no drop line.
  const insert = useInsertLine(recent ? null : path, pin)
  const rowId = pin ? `pin:${path}` : recent ? `recent:${path}` : path

  return (
    <>
      {insert === 'before' && <DropLine indent={indent} />}
      <div
        className={`row file${activePath === path ? ' active' : ''}${dragging ? ' is-dragging' : ''}`}
        style={{ paddingLeft: `${indent}px` }}
        data-path={recent || pin ? undefined : path}
        data-pin={pin ? path : undefined}
        data-kind="file"
        role="treeitem"
        aria-selected={activePath === path}
        aria-label={name}
        tabIndex={-1}
        onPointerDown={recent ? undefined : (e) => startDrag(e, path, pin)}
        onClick={() => void openFile(path)}
      >
        <RowName row={rowId} path={path} name={name} kind="file" />
        <span className="row-actions">
          <button
            className="icon-btn"
            title={isPinned ? 'Unpin' : 'Pin'}
            aria-label={isPinned ? `Unpin ${name}` : `Pin ${name}`}
            onClick={(e) => {
              e.stopPropagation()
              togglePin(path)
            }}
          >
            {/* outline tack pins; the filled one marks a pinned note and unpins */}
            {isPinned ? <PinTack size={14} /> : <Thumbtack2 size={14} />}
          </button>
          <button
            className="icon-btn"
            title="Rename"
            aria-label={`Rename ${name}`}
            onClick={(e) => {
              e.stopPropagation()
              startRename(rowId, path, name, 'file')
            }}
          >
            <Pen size={14} />
          </button>
          <button
            className="icon-btn"
            title="Delete"
            aria-label={`Delete ${name}`}
            onClick={(e) => {
              e.stopPropagation()
              void ask(`Delete “${name}”?`)
                .then((ok) => {
                  if (ok) return deleteFile(path)
                })
                .catch(say)
            }}
          >
            <Trash2 size={14} />
          </button>
        </span>
      </div>
      {insert === 'after' && <DropLine indent={indent} />}
    </>
  )
}

// In the drawer an inline field sits under the on-screen keyboard, so a phone gets
// a centred dialog instead — same field, somewhere the keyboard cannot cover it.
function startRename(row: string, path: string, name: string, kind: 'file' | 'dir') {
  if (!isNarrow()) {
    useStore.getState().setRenaming(row)
    return
  }
  void askText(kind === 'dir' ? 'Rename folder' : 'Rename note', name)
    .then((next) => {
      if (next && next !== name) return useStore.getState().renameEntry(path, next, kind)
    })
    .catch(say)
}

// `row` rather than `path`: a note open in the editor is listed twice, under Recent
// and in the tree. Keyed by path both copies grew a name field, and the second one
// autofocusing blurred the first, whose blur handler then closed them both.
function RowName({
  row,
  path,
  name,
  kind,
}: {
  row: string
  path: string
  name: string
  kind: 'file' | 'dir'
}) {
  const renaming = useStore((s) => s.renamingRow === row)
  const setRenaming = useStore((s) => s.setRenaming)
  const renameEntry = useStore((s) => s.renameEntry)

  if (!renaming) return <span className="row-name">{name}</span>

  return (
    <input
      className="rename-input"
      defaultValue={name}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()} // typing in the field is not a drag
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.currentTarget.value = name
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim()
        setRenaming(null)
        if (next && next !== name) void renameEntry(path, next, kind).catch(say)
      }}
    />
  )
}

// Where the insertion line goes for this row, if anywhere. Pins keep their own
// order whatever the sort mode; tree rows only have positions under manual sort.
// A note can sit in both places at once, so each row also checks that the drop
// is of its own kind — otherwise both copies would show the line.
function useInsertLine(path: string | null, pin?: boolean): 'before' | 'after' | null {
  return useStore((s) => {
    if (!path || s.dropAt?.anchor !== path) return null
    if (pin) return s.dropAt.dir === PIN_DIR ? s.dropAt.place : null
    return s.sort === 'manual' && s.dropAt.dir !== PIN_DIR ? s.dropAt.place : null
  })
}

function DropLine({ indent }: { indent: number }) {
  return <div className="drop-line" style={{ marginLeft: `${indent}px` }} />
}
