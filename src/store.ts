import { create } from 'zustand'
import {
  createNote,
  deleteNote,
  getAssetFile,
  noteMtime,
  pickVault,
  readNote,
  renameNote,
  requestVaultPermission,
  restoreVault,
  walkVault,
  writeNote,
  type TreeNode,
} from './vault'

const LAST_FILE = 'mdd:last-file'
const SIDEBAR_OPEN = 'mdd:sidebar-open'
const SIDEBAR_WIDTH = 'mdd:sidebar-width'
const RECENTS = 'mdd:recents'
const TAB_SIZE = 'mdd:tab-size'
const THEME = 'mdd:theme'
const OUTLINE_WIDTH = 'mdd:outline-width'
const COLLAPSED = 'mdd:collapsed-dirs'

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

function storedStrings(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

interface Store {
  vault: FileSystemDirectoryHandle | null
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

  init: () => Promise<void>
  openVault: () => Promise<void>
  reopenVault: () => Promise<void>
  refreshTree: () => Promise<void>
  openFile: (path: string) => Promise<void>
  onEdit: (text: string) => void
  saveNow: () => Promise<void>
  createFile: (dirPath?: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  renameFile: (path: string, newName: string) => Promise<void>
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
  async function activate(handle: FileSystemDirectoryHandle) {
    set({ vault: handle, pendingVault: null, vaultName: handle.name })
    await get().refreshTree()
    const last = localStorage.getItem(LAST_FILE)
    if (last) await get().openFile(last).catch(() => localStorage.removeItem(LAST_FILE))
  }

  function setRecents(recents: string[]) {
    localStorage.setItem(RECENTS, JSON.stringify(recents))
    set({ recents })
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

    init: async () => {
      const restored = await restoreVault()
      if (!restored) return
      if (restored.granted) await activate(restored.handle)
      else set({ pendingVault: restored.handle, vaultName: restored.handle.name })
    },

    openVault: async () => {
      const handle = await pickVault().catch(() => null) // user cancelled the picker
      if (handle) await activate(handle)
    },

    reopenVault: async () => {
      const handle = get().pendingVault
      if (handle && (await requestVaultPermission(handle))) await activate(handle)
    },

    refreshTree: async () => {
      const { vault } = get()
      if (!vault) return
      const scan = await walkVault(vault)
      mdIndex = scan.mdIndex
      assetIndex = scan.assetIndex
      set({ tree: scan.tree })
    },

    openFile: async (path) => {
      const { vault, dirty } = get()
      if (!vault) return
      if (dirty) await get().saveNow()
      const { text, mtime } = await readNote(vault, path)
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
      lastMtime = await writeNote(vault, activePath, liveText)
      set({ dirty: false, wordCount: countWords(liveText) })
    },

    createFile: async (dirPath = '') => {
      const { vault } = get()
      if (!vault) return
      const path = await createNote(vault, dirPath)
      await get().refreshTree()
      await get().openFile(path)
    },

    deleteFile: async (path) => {
      const { vault, activePath } = get()
      if (!vault) return
      await deleteNote(vault, path)
      setRecents(get().recents.filter((p) => p !== path))
      if (activePath === path) {
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
      await get().refreshTree()
    },

    renameFile: async (path, newName) => {
      const { vault, activePath } = get()
      if (!vault || !newName.trim()) return
      if (activePath === path) await get().saveNow()
      const newPath = await renameNote(vault, path, newName.trim())
      setRecents(get().recents.map((p) => (p === path ? newPath : p)))
      if (activePath === path) {
        localStorage.setItem(LAST_FILE, newPath)
        set({ activePath: newPath })
      }
      await get().refreshTree()
    },

    // On window focus: pick up edits made by Obsidian or sync while we were away.
    checkExternal: async () => {
      const { vault, activePath, dirty } = get()
      if (!vault) return
      await get().refreshTree()
      if (!activePath || dirty) return // ponytail: dirty local edits win; no merge UI
      try {
        if ((await noteMtime(vault, activePath)) !== lastMtime) {
          const { text, mtime } = await readNote(vault, activePath)
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
          return URL.createObjectURL(await getAssetFile(vault, path))
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
    await writeNote(s.vault, direct, '')
    await s.refreshTree()
    await s.openFile(direct)
  }
}
