// Remote vault client: talks to agent/server.mjs (exposed via Cloudflare Tunnel).

import type { TreeNode, Vault, VaultScan } from './vault'

const REMOTE_KEY = 'mdd:remote'

export interface RemoteConfig {
  url: string
  token: string
}

export function savedRemote(): RemoteConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(REMOTE_KEY) ?? '')
    return typeof v?.url === 'string' && typeof v?.token === 'string' ? v : null
  } catch {
    return null
  }
}

export function saveRemote(cfg: RemoteConfig): void {
  localStorage.setItem(REMOTE_KEY, JSON.stringify(cfg))
}

const fileQ = (path: string) => `/file?path=${encodeURIComponent(path)}`

export class RemoteVault implements Vault {
  private known = new Set<string>() // paths from last walk, for create() name probing
  private cfg: RemoteConfig
  constructor(cfg: RemoteConfig) {
    this.cfg = cfg
  }

  get name() {
    return new URL(this.cfg.url).hostname
  }

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(new URL(path, this.cfg.url), {
      ...init,
      headers: { authorization: `Bearer ${this.cfg.token}` },
    })
    if (!res.ok) throw new Error(`remote vault: ${res.status} on ${init.method ?? 'GET'} ${path}`)
    return res
  }

  // Flat list from the agent → same tree/index shapes walkVault produces.
  // Dirs materialize only via .md files, so asset-only dirs stay hidden like the local walk.
  async walk(): Promise<VaultScan> {
    const files: { path: string; mtime: number }[] = await (await this.req('/list')).json()
    this.known = new Set(files.map((f) => f.path))
    const mdIndex = new Map<string, string>()
    const assetIndex = new Map<string, string>()
    const rootNodes: TreeNode[] = []
    const dirs = new Map<string, TreeNode>()
    const childrenOf = (dirPath: string): TreeNode[] => {
      if (!dirPath) return rootNodes
      let node = dirs.get(dirPath)
      if (!node) {
        const i = dirPath.lastIndexOf('/')
        node = { name: dirPath.slice(i + 1), path: dirPath, kind: 'dir', children: [] }
        dirs.set(dirPath, node)
        childrenOf(i === -1 ? '' : dirPath.slice(0, i)).push(node)
      }
      return node.children!
    }
    for (const { path } of files) {
      const i = path.lastIndexOf('/')
      const name = path.slice(i + 1)
      if (name.endsWith('.md')) {
        const key = name.slice(0, -3).toLowerCase()
        if (!mdIndex.has(key)) mdIndex.set(key, path)
        childrenOf(i === -1 ? '' : path.slice(0, i)).push({
          name: name.slice(0, -3),
          path,
          kind: 'file',
        })
      } else if (!assetIndex.has(name.toLowerCase())) {
        assetIndex.set(name.toLowerCase(), path)
      }
    }
    const sortTree = (nodes: TreeNode[]) => {
      nodes.sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
      )
      for (const n of nodes) if (n.children) sortTree(n.children)
    }
    sortTree(rootNodes)
    return { tree: rootNodes, mdIndex, assetIndex }
  }

  async read(path: string) {
    const res = await this.req(fileQ(path))
    return { text: await res.text(), mtime: Number(res.headers.get('x-mtime')) }
  }

  async mtime(path: string) {
    const res = await this.req(fileQ(path), { method: 'HEAD' })
    return Number(res.headers.get('x-mtime'))
  }

  async write(path: string, text: string) {
    const res = await this.req(fileQ(path), { method: 'PUT', body: text })
    this.known.add(path)
    return ((await res.json()) as { mtime: number }).mtime
  }

  async create(dirPath = '') {
    for (let n = 0; ; n++) {
      const name = n === 0 ? 'Untitled.md' : `Untitled ${n}.md`
      const path = dirPath ? `${dirPath}/${name}` : name
      if (!this.known.has(path)) {
        await this.write(path, '')
        return path
      }
    }
  }

  async delete(path: string) {
    await this.req(fileQ(path), { method: 'DELETE' })
    this.known.delete(path)
  }

  assetFile(path: string) {
    return this.req(fileQ(path)).then((r) => r.blob())
  }
}
