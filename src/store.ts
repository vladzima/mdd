import { create } from 'zustand'
import {
  baseOf,
  dirOf,
  join,
  LocalVault,
  moveVia,
  pickVault,
  renamedPath,
  requestVaultPermission,
  restoreVault,
  type TreeNode,
  type Vault,
} from './vault'
import { childrenOf, placeIn, remapOrder, sortTree, SORTS, type ManualOrder, type Sort } from './sort'
import { dropAllowed, type DropAt } from './drag'
import { tell } from './dialog'
import { isNarrow } from './layout'
import { saveSsh, savedSsh, type SshConfig } from './sshConfig'

const LAST_FILE = 'mdd:last-file'
const VAULT_MODE = 'mdd:vault-mode' // 'local' | 'ssh' | 'none' (missing = 'local')
const SIDEBAR_OPEN = 'mdd:sidebar-open'
const SIDEBAR_WIDTH = 'mdd:sidebar-width'
const RECENTS = 'mdd:recents'
const TAB_SIZE = 'mdd:tab-size'
const THEME = 'mdd:theme'
const OUTLINE_WIDTH = 'mdd:outline-width'
const COLLAPSED = 'mdd:collapsed-dirs'
const SORT = 'mdd:sort'
const MANUAL_ORDER = 'mdd:manual-order'

export const THEMES = ['system', 'light', 'dark', 'vesper'] as const
export type Theme = (typeof THEMES)[number]

function storedTheme(): Theme {
  const t = localStorage.getItem(THEME)
  return (THEMES as readonly string[]).includes(t ?? '') ? (t as Theme) : 'system'
}

// Live editor text sits outside reactive state — updated every keystroke, read on save.
let liveText: string | null = null
let lastMtime = 0
let saveTimer: ReturnType<typeof setTimeout> | undefined

// Vault-wide name indexes, rebuilt on every tree refresh.
let mdIndex = new Map<string, string>()
let assetIndex = new Map<string, string>()
// ponytail: object URLs cached for the session, never revoked; stale if an image changes on disk
const assetCache = new Map<string, Promise<string | null>>()

function countWords(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

export interface OutlineItem {
  level: number
  text: string
  line: number
}

export function extractOutline(text: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let inFence = false
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{1,6})\s+(.+)/.exec(lines[i])
    if (m) {
      const clean = m[2]
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .trim()
      items.push({ level: m[1].length, text: clean, line: i + 1 })
    }
  }
  return items
}

// A new note is born "Untitled" and renames itself once its first H1 is written.
// Only files still carrying the placeholder are touched, so a name you chose is
// never overwritten, and the rename waits until the heading line is finished —
// otherwise every pause while typing a title would rename the file again.
const PLACEHOLDER = /^Untitled( \d+)?\.md$/

export function autoName(text: string): string | null {
  const h = extractOutline(text).find((x) => x.level === 1)
  if (!h || text.split('\n').length <= h.line) return null // still on the title line
  const name = h.text
    .replace(/[/\\:<>"|?*]/g, '') // illegal in a filename on some host
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '') // a leading dot would hide the file
    .trim()
    .slice(0, 80)
    .trim()
  return name || null
}

function storedStrings(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

function storedSort(): Sort {
  const s = localStorage.getItem(SORT)
  return (SORTS as readonly string[]).includes(s ?? '') ? (s as Sort) : 'name'
}

function storedOrder(): ManualOrder {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(MANUAL_ORDER) ?? '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: ManualOrder = {}
    for (const [dir, paths] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(paths)) out[dir] = paths.filter((p): p is string => typeof p === 'string')
    }
    return out
  } catch {
    return {}
  }
}

interface Store {
  vault: Vault | null
  pendingVault: FileSystemDirectoryHandle | null // restored, awaiting permission gesture
  vaultName: string
  tree: TreeNode[]
  activePath: string | null
  doc: string
  docVersion: number // bump = editor resets its document
  dirty: boolean
  wordCount: number
  outline: OutlineItem[]
  outlineActive: number | null // line of the heading the viewport is in
  recents: string[]
  sidebarOpen: boolean
  sidebarWidth: number
  outlineWidth: number
  collapsedDirs: Set<string>
  settingsOpen: boolean
  tabSize: number
  theme: Theme
  sort: Sort
  manualOrder: ManualOrder
  renamingRow: string | null // id of the row showing its name field
  drag: string | null // path being dragged
  dropAt: DropAt | null // where it would land if released now

  init: () => Promise<void>
  openVault: () => Promise<void>
  reopenVault: () => Promise<void>
  connectSsh: (cfg: SshConfig, remember: boolean) => Promise<void>
  closeVault: () => Promise<void>
  refreshTree: () => Promise<void>
  openFile: (path: string) => Promise<void>
  onEdit: (text: string) => void
  saveNow: () => Promise<void>
  createFile: (dirPath?: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  renameEntry: (path: string, newName: string, kind: 'file' | 'dir') => Promise<void>
  createDir: (dirPath?: string) => Promise<void>
  deleteDir: (path: string) => Promise<void>
  setRenaming: (row: string | null) => void
  setSort: (sort: Sort) => void
  beginDrag: (path: string) => void
  hoverDrag: (at: DropAt | null) => void
  endDrag: () => void
  applyDrop: (path: string, at: DropAt) => Promise<void>
  checkExternal: () => Promise<void>
  updateOutlineActive: (topLine: number) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setOutlineWidth: (width: number) => void
  toggleDir: (path: string) => void
  setSettingsOpen: (open: boolean) => void
  setTabSize: (size: number) => void
  setTheme: (theme: Theme) => void
}

export const useStore = create<Store>()((set, get) => {
  async function activate(vault: Vault) {
    await get().vault?.close?.() // drop a previous SSH session before swapping vaults
    assetCache.clear() // object URLs from a previous vault would serve the wrong files
    set({ vault, pendingVault: null, vaultName: vault.name })
    await get().refreshTree()
    const last = localStorage.getItem(LAST_FILE)
    if (last) await get().openFile(last).catch(() => localStorage.removeItem(LAST_FILE))
  }

  function setRecents(recents: string[]) {
    localStorage.setItem(RECENTS, JSON.stringify(recents))
    set({ recents })
  }

  function setManualOrder(manualOrder: ManualOrder) {
    localStorage.setItem(MANUAL_ORDER, JSON.stringify(manualOrder))
    set({ manualOrder })
  }

  // Renaming or moving a folder takes everything under it along, so each path the
  // app is holding on to has to follow: the open note, the recents, which folders
  // are collapsed, and the manual order. `to === null` means it was deleted.
  function repath(from: string, to: string | null) {
    const under = (p: string) => p === from || p.startsWith(`${from}/`)
    const moved = (p: string) => (to === null ? null : to + p.slice(from.length))
    const keep = (p: string | null): p is string => p !== null
    const { activePath, recents, collapsedDirs, manualOrder } = get()

    setRecents(recents.map((p) => (under(p) ? moved(p) : p)).filter(keep))
    setManualOrder(remapOrder(manualOrder, from, to))

    const collapsed = new Set(
      [...collapsedDirs].map((p) => (under(p) ? moved(p) : p)).filter(keep),
    )
    localStorage.setItem(COLLAPSED, JSON.stringify([...collapsed]))
    set({ collapsedDirs: collapsed })

    if (!activePath || !under(activePath)) return
    const next = moved(activePath)
    if (next) {
      localStorage.setItem(LAST_FILE, next)
      set({ activePath: next })
      return
    }
    liveText = null
    localStorage.removeItem(LAST_FILE)
    set({
      activePath: null,
      doc: '',
      dirty: false,
      wordCount: 0,
      outline: [],
      outlineActive: null,
    })
  }

  return {
    vault: null,
    pendingVault: null,
    vaultName: '',
    tree: [],
    activePath: null,
    doc: '',
    docVersion: 0,
    dirty: false,
    wordCount: 0,
    outline: [],
    outlineActive: null,
    recents: storedStrings(RECENTS),
    sidebarOpen: localStorage.getItem(SIDEBAR_OPEN) !== '0',
    sidebarWidth: Number(localStorage.getItem(SIDEBAR_WIDTH)) || 240,
    outlineWidth: Number(localStorage.getItem(OUTLINE_WIDTH)) || 210,
    collapsedDirs: new Set(storedStrings(COLLAPSED)),
    settingsOpen: false,
    tabSize: localStorage.getItem(TAB_SIZE) === '4' ? 4 : 2,
    theme: storedTheme(),
    sort: storedSort(),
    manualOrder: storedOrder(),
    renamingRow: null,
    drag: null,
    dropAt: null,

    init: async () => {
      const mode = localStorage.getItem(VAULT_MODE) ?? 'local'
      if (mode === 'ssh') {
        // Only auto-reconnect when the secret was remembered; otherwise Welcome asks for it.
        const cfg = savedSsh()
        if (cfg?.password || cfg?.privateKey) await get().connectSsh(cfg, true).catch(() => {})
        return
      }
      const restored = await restoreVault()
      if (!restored) return
      // mode 'none' (user switched away): surface the saved dir on Welcome, don't auto-open
      if (mode === 'local' && restored.granted) await activate(new LocalVault(restored.handle))
      else set({ pendingVault: restored.handle, vaultName: restored.handle.name })
    },

    openVault: async () => {
      const handle = await pickVault().catch(() => null) // user cancelled the picker
      if (handle) {
        localStorage.setItem(VAULT_MODE, 'local')
        await activate(new LocalVault(handle))
      }
    },

    reopenVault: async () => {
      const handle = get().pendingVault
      if (handle && (await requestVaultPermission(handle))) {
        localStorage.setItem(VAULT_MODE, 'local')
        await activate(new LocalVault(handle))
      }
    },

    connectSsh: async (cfg, remember) => {
      // Lazy chunk keeps the SSH libs out of the initial load. A deploy replaces the
      // hashed filename, so a tab left open since the previous version asks for a file
      // that no longer exists and gets the SPA fallback HTML back.
      const { connectSsh } = await import('./ssh').catch((err: unknown) => {
        // Only a genuine fetch failure means a stale tab; anything else is a real
        // error inside the chunk and must not be masked.
        if (/dynamically imported module|MIME type/i.test(String(err))) {
          throw new Error('This app was updated in the background — reload the page, then connect.')
        }
        throw err
      })
      const vault = await connectSsh(cfg)
      saveSsh(cfg, remember)
      localStorage.setItem(VAULT_MODE, 'ssh')
      await activate(vault)
    },

    closeVault: async () => {
      await get().saveNow()
      await get().vault?.close?.()
      localStorage.setItem(VAULT_MODE, 'none')
      localStorage.removeItem(LAST_FILE)
      liveText = null
      const restored = await restoreVault()
      set({
        vault: null,
        pendingVault: restored?.handle ?? null,
        vaultName: restored?.handle.name ?? '',
        tree: [],
        activePath: null,
        doc: '',
        dirty: false,
        wordCount: 0,
        outline: [],
        outlineActive: null,
      })
    },

    refreshTree: async () => {
      const { vault } = get()
      if (!vault) return
      const scan = await vault.walk()
      mdIndex = scan.mdIndex
      assetIndex = scan.assetIndex
      set({ tree: scan.tree })
    },

    openFile: async (path) => {
      const { vault, dirty } = get()
      if (!vault) return
      if (dirty) await get().saveNow()
      const { text, mtime } = await vault.read(path)
      liveText = text
      lastMtime = mtime
      localStorage.setItem(LAST_FILE, path)
      setRecents([path, ...get().recents.filter((p) => p !== path)].slice(0, 5))
      set({
        activePath: path,
        doc: text,
        docVersion: get().docVersion + 1,
        dirty: false,
        wordCount: countWords(text),
        outline: extractOutline(text),
        outlineActive: null,
      })
      // On a phone the sidebar is an overlay covering the note it just opened.
      // Deliberately tied to opening a file rather than to activePath changing,
      // so renaming the open note doesn't yank the drawer shut. Not persisted:
      // it's a consequence of navigating, not a preference.
      if (isNarrow() && get().sidebarOpen) set({ sidebarOpen: false })
    },

    onEdit: (text) => {
      liveText = text
      if (!get().dirty) set({ dirty: true })
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        set({ outline: extractOutline(liveText ?? '') })
        void get().saveNow()
      }, 800)
    },

    saveNow: async () => {
      const { vault, activePath, dirty } = get()
      if (!vault || !activePath || !dirty || liveText == null) return
      clearTimeout(saveTimer)
      lastMtime = await vault.write(activePath, liveText)
      set({ dirty: false, wordCount: countWords(liveText) })

      const base = activePath.split('/').pop()!
      const titled = PLACEHOLDER.test(base) ? autoName(liveText) : null
      if (titled && `${titled}.md` !== base) {
        // a taken name throws out of moveVia; the note simply stays Untitled
        await get().renameEntry(activePath, titled, 'file').catch(() => {})
      }
    },

    createFile: async (dirPath = '') => {
      const { vault } = get()
      if (!vault) return
      const path = await vault.create(dirPath)
      if (dirPath && get().collapsedDirs.has(dirPath)) get().toggleDir(dirPath)
      await get().refreshTree()
      await get().openFile(path)
    },

    deleteFile: async (path) => {
      const { vault } = get()
      if (!vault) return
      await vault.delete(path)
      repath(path, null)
      await get().refreshTree()
    },

    renameEntry: async (path, newName, kind) => {
      const { vault } = get()
      if (!vault || !newName.trim()) return
      if (get().activePath === path) await get().saveNow()
      const newPath = await moveVia(vault, path, renamedPath(path, newName.trim(), kind))
      repath(path, newPath)
      await get().refreshTree()
    },

    createDir: async (dirPath = '') => {
      const { vault } = get()
      if (!vault) return
      let path = ''
      for (let n = 0; ; n++) {
        path = join(dirPath, n === 0 ? 'New folder' : `New folder ${n}`)
        if (!(await vault.exists(path))) break
      }
      await vault.mkdir(path)
      if (dirPath && get().collapsedDirs.has(dirPath)) get().toggleDir(dirPath)
      await get().refreshTree()
      set({ renamingRow: path }) // the placeholder name is not one anybody wants to keep
    },

    deleteDir: async (path) => {
      const { vault, tree } = get()
      if (!vault) return
      if (childrenOf(tree, path).length > 0) {
        throw new Error(`“${baseOf(path)}” isn’t empty — move or delete what’s inside it first`)
      }
      // The tree only lists notes and folders, so a folder of images still looks
      // empty here; the filesystem is the one that actually enforces the rule.
      await vault.rmdir(path).catch((err: unknown) => {
        throw new Error(
          `Couldn’t delete “${baseOf(path)}” — it may still hold files that aren’t notes ` +
            `(${String((err as Error).message)})`,
        )
      })
      repath(path, null)
      await get().refreshTree()
    },

    setRenaming: (row) => set({ renamingRow: row }),

    setSort: (sort) => {
      localStorage.setItem(SORT, sort)
      set({ sort })
    },

    beginDrag: (path) => set({ drag: path, dropAt: null }),

    hoverDrag: (at) => {
      const { dropAt } = get()
      // same target as last frame: skip the render, this runs on every pointermove
      const same =
        at === dropAt ||
        (at &&
          dropAt &&
          at.dir === dropAt.dir &&
          at.anchor === dropAt.anchor &&
          at.place === dropAt.place)
      if (!same) set({ dropAt: at })
    },

    endDrag: () => set({ drag: null, dropAt: null }),

    applyDrop: async (path, at) => {
      const { vault, sort } = get()
      if (!vault || !dropAllowed(path, at)) return
      let moved = path
      if (dirOf(path) !== at.dir) {
        if (get().activePath === path) await get().saveNow()
        try {
          moved = await moveVia(vault, path, join(at.dir, baseOf(path)))
        } catch (err: unknown) {
          void tell(err)
          return
        }
        repath(path, moved)
        // dropping into a collapsed folder would read as the note having vanished
        if (at.dir && get().collapsedDirs.has(at.dir)) get().toggleDir(at.dir)
        await get().refreshTree()
      }
      if (sort !== 'manual') return
      const shown = sortTree(childrenOf(get().tree, at.dir), 'manual', get().manualOrder, at.dir)
      setManualOrder({
        ...get().manualOrder,
        [at.dir]: placeIn(shown.map((n) => n.path), moved, at.anchor, at.place),
      })
    },

    // On window focus: pick up edits made by Obsidian or sync while we were away.
    checkExternal: async () => {
      const { vault, activePath, dirty } = get()
      if (!vault) return
      await get().refreshTree()
      if (!activePath || dirty) return // ponytail: dirty local edits win; no merge UI
      try {
        if ((await vault.mtime(activePath)) !== lastMtime) {
          const { text, mtime } = await vault.read(activePath)
          liveText = text
          lastMtime = mtime
          set({
            doc: text,
            docVersion: get().docVersion + 1,
            wordCount: countWords(text),
            outline: extractOutline(text),
          })
        }
      } catch {
        // deleted externally
        set({
          activePath: null,
          doc: '',
          dirty: false,
          wordCount: 0,
          outline: [],
          outlineActive: null,
        })
      }
    },

    updateOutlineActive: (topLine) => {
      const { outline, outlineActive } = get()
      let active: number | null = null
      for (const h of outline) {
        if (h.line <= topLine) active = h.line
        else break
      }
      if (active !== outlineActive) set({ outlineActive: active })
    },

    toggleSidebar: () => {
      const open = !get().sidebarOpen
      localStorage.setItem(SIDEBAR_OPEN, open ? '1' : '0')
      set({ sidebarOpen: open })
    },

    setSidebarWidth: (width) => {
      localStorage.setItem(SIDEBAR_WIDTH, String(width))
      set({ sidebarWidth: width })
    },

    setOutlineWidth: (width) => {
      localStorage.setItem(OUTLINE_WIDTH, String(width))
      set({ outlineWidth: width })
    },

    toggleDir: (path) => {
      const collapsed = new Set(get().collapsedDirs)
      if (collapsed.has(path)) collapsed.delete(path)
      else collapsed.add(path)
      localStorage.setItem(COLLAPSED, JSON.stringify([...collapsed]))
      set({ collapsedDirs: collapsed })
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),

    setTabSize: (size) => {
      localStorage.setItem(TAB_SIZE, String(size))
      set({ tabSize: size })
    },

    setTheme: (theme) => {
      localStorage.setItem(THEME, theme)
      set({ theme })
    },
  }
})

// --- asset + wikilink resolution (used by the live preview) ---

export function resolveAsset(src: string): Promise<string | null> {
  if (/^(https?:|data:)/.test(src)) return Promise.resolve(src)
  const { vault, activePath } = useStore.getState()
  if (!vault) return Promise.resolve(null)
  const noteDir = activePath?.includes('/')
    ? activePath.slice(0, activePath.lastIndexOf('/'))
    : ''
  const key = `${noteDir}|${src}`
  let cached = assetCache.get(key)
  if (!cached) {
    cached = (async () => {
      const raw = decodeURIComponent(src).replace(/^\.\//, '')
      const candidates = [raw]
      if (noteDir) candidates.push(`${noteDir}/${raw}`)
      const byName = assetIndex.get(raw.split('/').pop()!.toLowerCase())
      if (byName) candidates.push(byName)
      for (const path of candidates) {
        try {
          return URL.createObjectURL(await vault.assetFile(path))
        } catch {
          // try next candidate
        }
      }
      return null
    })()
    assetCache.set(key, cached)
  }
  return cached
}

export async function openWikilink(target: string): Promise<void> {
  const s = useStore.getState()
  if (!s.vault) return
  const name = target.trim()
  const direct = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
  try {
    await s.openFile(direct) // covers [[folder/Note]] and exact root-level names
    return
  } catch {
    // not a direct path
  }
  const indexed = mdIndex.get(name.split('/').pop()!.toLowerCase().replace(/\.md$/, ''))
  if (indexed) {
    await s.openFile(indexed)
    return
  }
  if (!name.includes('/')) {
    // unresolved: create the note in the vault root, Obsidian-style
    await s.vault.write(direct, '')
    await s.refreshTree()
    await s.openFile(direct)
  }
}
