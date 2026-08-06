// Vault layer: File System Access API + IndexedDB handle persistence.

export interface TreeNode {
  name: string
  path: string // vault-relative, '/'-separated, includes .md for files
  kind: 'file' | 'dir'
  mtime: number // ms; a folder carries its newest descendant, so date sort can place it
  children?: TreeNode[]
}

export const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))
export const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
export const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

const newest = (nodes: TreeNode[]): number => nodes.reduce((m, n) => Math.max(m, n.mtime), 0)

// Folders first, then by name — the order the tree is stored in. Sidebar re-sorts
// on top of this for the date and manual modes.
export function byName(a: TreeNode, b: TreeNode): number {
  return a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1
}

// `typeof window` guard: the SFTP tests bundle this module into Node, which has no window
export const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

// --- IndexedDB kv (persists the directory handle across sessions) ---

const DB_NAME = 'mdd'
const KV = 'kv'
const VAULT_KEY = 'vault-handle'

function kv<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(KV)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const req = op(db.transaction(KV, mode).objectStore(KV))
      req.onsuccess = () => {
        db.close()
        resolve(req.result)
      }
      req.onerror = () => {
        db.close()
        reject(req.error)
      }
    }
  })
}

// --- vault open/restore ---

export async function pickVault(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: 'mdd-vault', mode: 'readwrite' })
  await kv('readwrite', (s) => s.put(handle, VAULT_KEY))
  return handle
}

export async function restoreVault(): Promise<{
  handle: FileSystemDirectoryHandle
  granted: boolean
} | null> {
  const handle = await kv<FileSystemDirectoryHandle | undefined>('readonly', (s) =>
    s.get(VAULT_KEY),
  ).catch(() => undefined)
  if (!handle) return null
  const perm = await handle.queryPermission({ mode: 'readwrite' })
  return { handle, granted: perm === 'granted' }
}

export async function requestVaultPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
}

// --- tree ---

export interface VaultScan {
  tree: TreeNode[]
  mdIndex: Map<string, string> // note name (lowercase, no .md) → path, for wikilinks
  assetIndex: Map<string, string> // filename (lowercase) → path, for image embeds
}

export async function walkVault(root: FileSystemDirectoryHandle): Promise<VaultScan> {
  const mdIndex = new Map<string, string>()
  const assetIndex = new Map<string, string>()
  const tree = await walk(root, '', mdIndex, assetIndex)
  return { tree, mdIndex, assetIndex }
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  mdIndex: Map<string, string>,
  assetIndex: Map<string, string>,
): Promise<TreeNode[]> {
  const nodes: TreeNode[] = []
  const notes: FileSystemFileHandle[] = []
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.')) continue // .obsidian, .git, .trash
    if (entry.kind === 'directory') {
      const children = await walk(entry, `${prefix}${entry.name}/`, mdIndex, assetIndex)
      // Empty folders are listed too — one you just created has nothing in it yet,
      // and a folder you cannot see is a folder you cannot drag a note into.
      nodes.push({
        name: entry.name,
        path: prefix + entry.name,
        kind: 'dir',
        mtime: newest(children),
        children,
      })
    } else if (entry.name.endsWith('.md')) {
      notes.push(entry)
    } else {
      const key = entry.name.toLowerCase()
      if (!assetIndex.has(key)) assetIndex.set(key, prefix + entry.name)
    }
  }
  // One getFile() per note buys the mtime that date sorting needs; issued together
  // so a folder costs one round of latency rather than one per file.
  const files = await Promise.all(notes.map((h) => h.getFile()))
  notes.forEach((h, i) => {
    const key = h.name.slice(0, -3).toLowerCase()
    if (!mdIndex.has(key)) mdIndex.set(key, prefix + h.name)
    nodes.push({
      name: h.name.slice(0, -3),
      path: prefix + h.name,
      kind: 'file',
      mtime: files[i].lastModified,
    })
  })
  nodes.sort(byName)
  return nodes
}

export async function getAssetFile(root: FileSystemDirectoryHandle, path: string): Promise<File> {
  return (await getFileHandle(root, path)).getFile()
}

// --- file ops (paths are vault-relative like "folder/note.md") ---

async function resolveDir(
  root: FileSystemDirectoryHandle,
  dirPath: string,
): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const seg of dirPath.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(seg)
  }
  return dir
}

async function getFileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemFileHandle> {
  const i = path.lastIndexOf('/')
  const dir = await resolveDir(root, i === -1 ? '' : path.slice(0, i))
  return dir.getFileHandle(path.slice(i + 1), { create })
}

export async function readNote(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<{ text: string; mtime: number }> {
  const file = await (await getFileHandle(root, path)).getFile()
  return { text: await file.text(), mtime: file.lastModified }
}

export async function noteMtime(root: FileSystemDirectoryHandle, path: string): Promise<number> {
  return (await (await getFileHandle(root, path)).getFile()).lastModified
}

export async function writeNote(
  root: FileSystemDirectoryHandle,
  path: string,
  text: string,
): Promise<number> {
  const handle = await getFileHandle(root, path, true)
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
  return (await handle.getFile()).lastModified
}

export async function createNote(root: FileSystemDirectoryHandle, dirPath = ''): Promise<string> {
  const dir = await resolveDir(root, dirPath)
  for (let n = 0; ; n++) {
    const name = n === 0 ? 'Untitled.md' : `Untitled ${n}.md`
    const taken = await dir
      .getFileHandle(name)
      .then(() => true)
      .catch(() => false)
    if (!taken) {
      await dir.getFileHandle(name, { create: true })
      return dirPath ? `${dirPath}/${name}` : name
    }
  }
}

export async function deleteNote(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const dir = await resolveDir(root, dirOf(path))
  await dir.removeEntry(baseOf(path))
}

// --- directories ---

export async function makeDir(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  let dir = root
  for (const seg of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(seg, { create: true })
  }
}

export async function removeDir(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parent = await resolveDir(root, dirOf(path))
  // No `recursive` flag on purpose: the browser refuses a folder that still has
  // anything in it, which is exactly the "delete empty folders only" rule.
  await parent.removeEntry(baseOf(path))
}

export async function pathExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  const parent = await resolveDir(root, dirOf(path)).catch(() => null)
  if (!parent) return false
  const name = baseOf(path)
  return parent
    .getFileHandle(name)
    .then(() => true)
    .catch(() => parent.getDirectoryHandle(name).then(() => true, () => false))
}

// FileSystemHandle.move() covers files from Chromium 111; directories are still
// walked entry by entry. The byte-copy fallback (rather than read-as-text) is what
// lets an images folder move without corrupting what is inside it.
async function moveEntry(
  entry: FileSystemHandle,
  dstDir: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  if (entry.kind === 'file') {
    const file = entry as FileSystemFileHandle
    if (file.move) {
      await file.move(dstDir, name)
      return
    }
    const writable = await (await dstDir.getFileHandle(name, { create: true })).createWritable()
    await writable.write(await file.getFile())
    await writable.close()
    return
  }
  const src = entry as FileSystemDirectoryHandle
  const dst = await dstDir.getDirectoryHandle(name, { create: true })
  const kids: FileSystemHandle[] = []
  for await (const kid of src.values()) kids.push(kid) // snapshot: moving mutates src
  for (const kid of kids) await moveEntry(kid, dst, kid.name)
}

export async function movePath(
  root: FileSystemDirectoryHandle,
  from: string,
  to: string,
): Promise<void> {
  const fromParent = await resolveDir(root, dirOf(from))
  const toParent = await resolveDir(root, dirOf(to))
  const name = baseOf(from)
  const entry: FileSystemHandle = await fromParent
    .getFileHandle(name)
    .catch(() => fromParent.getDirectoryHandle(name))
  await moveEntry(entry, toParent, baseOf(to))
  // A native move already unlinked the source; a copy did not. Either way the data
  // is at the destination by now, so a failure here must not read as a failed move.
  await fromParent.removeEntry(name, { recursive: true }).catch(() => {})
}

// --- Vault interface: local (FSA) and remote agent impls share this ---

export interface Vault {
  readonly name: string
  walk(): Promise<VaultScan>
  read(path: string): Promise<{ text: string; mtime: number }>
  mtime(path: string): Promise<number>
  write(path: string, text: string): Promise<number>
  create(dirPath?: string): Promise<string>
  delete(path: string): Promise<void>
  assetFile(path: string): Promise<Blob>
  exists(path: string): Promise<boolean> // file or directory
  mkdir(path: string): Promise<void>
  rmdir(path: string): Promise<void> // refuses a folder that still has anything in it
  move(path: string, newPath: string): Promise<void> // rename and reparent, file or dir
  close?(): Promise<void> // tear down a live connection, if the backend holds one
}

export class LocalVault implements Vault {
  readonly handle: FileSystemDirectoryHandle
  constructor(handle: FileSystemDirectoryHandle) {
    this.handle = handle
  }
  get name() {
    return this.handle.name
  }
  walk() {
    return walkVault(this.handle)
  }
  read(path: string) {
    return readNote(this.handle, path)
  }
  mtime(path: string) {
    return noteMtime(this.handle, path)
  }
  write(path: string, text: string) {
    return writeNote(this.handle, path, text)
  }
  create(dirPath?: string) {
    return createNote(this.handle, dirPath)
  }
  delete(path: string) {
    return deleteNote(this.handle, path)
  }
  assetFile(path: string) {
    return getAssetFile(this.handle, path)
  }
  exists(path: string) {
    return pathExists(this.handle, path)
  }
  mkdir(path: string) {
    return makeDir(this.handle, path)
  }
  rmdir(path: string) {
    return removeDir(this.handle, path)
  }
  move(path: string, newPath: string) {
    return movePath(this.handle, path, newPath)
  }
}

// The one door every rename and every drag goes through, so the "never clobber"
// check cannot be forgotten at a call site.
export async function moveVia(v: Vault, path: string, newPath: string): Promise<string> {
  if (newPath === path) return path
  if (await v.exists(newPath)) throw new Error(`“${baseOf(newPath)}” already exists here`)
  await v.move(path, newPath)
  return newPath
}

// Rename in place: same folder, new leaf name. `.md` is implied for notes.
export function renamedPath(path: string, newName: string, kind: 'file' | 'dir'): string {
  const name = kind === 'file' && !newName.endsWith('.md') ? `${newName}.md` : newName
  return join(dirOf(path), name)
}
