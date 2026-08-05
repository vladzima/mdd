// Vault layer: File System Access API + IndexedDB handle persistence.

export interface TreeNode {
  name: string
  path: string // vault-relative, '/'-separated, includes .md for files
  kind: 'file' | 'dir'
  children?: TreeNode[]
}

export const supported = 'showDirectoryPicker' in window

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
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.')) continue // .obsidian, .git, .trash
    if (entry.kind === 'directory') {
      const children = await walk(entry, `${prefix}${entry.name}/`, mdIndex, assetIndex)
      // ponytail: dirs with no md files are hidden; add "new folder" UI if ever needed
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: prefix + entry.name, kind: 'dir', children })
      }
    } else if (entry.name.endsWith('.md')) {
      const key = entry.name.slice(0, -3).toLowerCase()
      if (!mdIndex.has(key)) mdIndex.set(key, prefix + entry.name)
      nodes.push({ name: entry.name.slice(0, -3), path: prefix + entry.name, kind: 'file' })
    } else {
      const key = entry.name.toLowerCase()
      if (!assetIndex.has(key)) assetIndex.set(key, prefix + entry.name)
    }
  }
  nodes.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
  )
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
  const i = path.lastIndexOf('/')
  const dir = await resolveDir(root, i === -1 ? '' : path.slice(0, i))
  await dir.removeEntry(path.slice(i + 1))
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
  rename?(path: string, newPath: string): Promise<void> // native move, when the backend has one
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
}

// ponytail: rename = copy + delete (FileSystemFileHandle.move is not universally shipped)
export async function renameVia(v: Vault, path: string, newName: string): Promise<string> {
  const name = newName.endsWith('.md') ? newName : `${newName}.md`
  const i = path.lastIndexOf('/')
  const newPath = i === -1 ? name : `${path.slice(0, i)}/${name}`
  if (newPath === path) return path
  // Never overwrite: without a native rename this is read + write + delete, which
  // would destroy whatever already sits at newPath.
  if (await v.mtime(newPath).then(() => true, () => false)) {
    throw new Error(`“${name}” already exists here`)
  }
  if (v.rename) {
    await v.rename(path, newPath)
    return newPath
  }
  const { text } = await v.read(path)
  await v.write(newPath, text)
  await v.delete(path)
  return newPath
}
