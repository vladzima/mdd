// SSH vault: the browser speaks SSH+SFTP end-to-end; the Worker at /relay is a
// dumb WebSocket→TCP pipe, so credentials and file data are encrypted before
// they leave the page. Nothing to install on the server — just sshd.

import { Buffer } from 'buffer' // globals for the library are set in nodeGlobals.ts
import {
  CommandRequestMessage,
  SshAuthenticationType,
  SshClientSession,
  SshDisconnectReason,
  SshSessionConfiguration,
  WebSocketStream,
  type SshAuthenticatingEventArgs,
  type SshClientCredentials,
} from '@microsoft/dev-tunnels-ssh'
import { importKeyBytes } from '@microsoft/dev-tunnels-ssh-keys'
import { Sftp } from './sftp'
import { hostKeyStore, pinHostKey, type SshConfig } from './sshConfig'
import type { TreeNode, Vault, VaultScan } from './vault'

// --- host key TOFU: pin on first connect, refuse silent changes ---

async function fingerprint(bytes: Buffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=+$/, '')
}

export class HostKeyChangedError extends Error {
  readonly hostId: string
  readonly got: string
  readonly pinned: string
  constructor(hostId: string, got: string, pinned: string) {
    super(
      `Host key for ${hostId} changed (SHA256:${got}, expected SHA256:${pinned}). ` +
        'If you rebuilt the server, forget the old key in the connect form; otherwise stop — ' +
        'this can mean someone is intercepting the connection.',
    )
    this.hostId = hostId
    this.got = got
    this.pinned = pinned
  }
}

async function checkHostKey(hostId: string, e: SshAuthenticatingEventArgs): Promise<void> {
  const bytes = await e.publicKey?.getPublicKeyBytes()
  if (!bytes) throw new Error('server did not present a host key')
  const fp = await fingerprint(bytes)
  const pinned = hostKeyStore()[hostId]
  if (pinned && pinned !== fp) throw new HostKeyChangedError(hostId, fp, pinned)
  if (!pinned) pinHostKey(hostId, fp)
}

// --- connect ---

export async function connectSsh(cfg: SshConfig): Promise<SshVault> {
  const hostId = `${cfg.host}:${cfg.port}`
  const relay = new URL('/relay', location.origin)
  relay.protocol = relay.protocol === 'http:' ? 'ws:' : 'wss:'
  relay.searchParams.set('host', cfg.host)
  relay.searchParams.set('port', String(cfg.port))

  const ws = new WebSocket(relay)
  ws.binaryType = 'arraybuffer'
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error(`can't reach ${hostId} — check the host, port and that sshd is running`))
  })

  const session = new SshClientSession(new SshSessionConfiguration())
  let hostKeyError: unknown = null
  session.onAuthenticating((e: SshAuthenticatingEventArgs) => {
    if (e.authenticationType !== SshAuthenticationType.serverPublicKey) return
    // Returning a principal means "server accepted"; throwing here would be swallowed,
    // so record the failure and surface it after authenticate() returns false.
    e.authenticationPromise = checkHostKey(hostId, e)
      .then(() => ({}))
      .catch((err) => {
        hostKeyError = err
        return null
      })
  })

  try {
    await session.connect(new WebSocketStream(ws))
    const credentials: SshClientCredentials = { username: cfg.username }
    if (cfg.privateKey) {
      credentials.publicKeys = [await importKeyBytes(Buffer.from(cfg.privateKey, 'utf8'))]
    } else {
      credentials.password = cfg.password
    }
    const ok = await session.authenticate(credentials)
    if (hostKeyError) throw hostKeyError
    if (!ok) {
      throw new Error(
        cfg.privateKey
          ? 'server rejected the key — check the username and that the key is in ~/.ssh/authorized_keys'
          : 'server rejected the username or password (some servers allow keys only)',
      )
    }

    const channel = await session.openChannel()
    const req = new CommandRequestMessage()
    req.requestType = 'subsystem'
    req.command = 'sftp'
    if (!(await channel.request(req))) {
      throw new Error('server refused SFTP — enable the sftp subsystem in sshd_config')
    }
    const sftp = await Sftp.open(channel)
    const root = (await sftp.realpath(cfg.path || '.')).replace(/\/+$/, '')
    const st = await sftp.stat(root)
    if ((st.mode & 0o170000) !== 0o040000) throw new Error(`${root} is not a directory`)
    return new SshVault(session, sftp, root, cfg)
  } catch (err) {
    await session.close(SshDisconnectReason.byApplication).catch(() => {})
    ws.close()
    throw err
  }
}

export class SshVault implements Vault {
  private session: SshClientSession
  private sftp: Sftp
  private root: string
  private cfg: SshConfig

  constructor(session: SshClientSession, sftp: Sftp, root: string, cfg: SshConfig) {
    this.session = session
    this.sftp = sftp
    this.root = root
    this.cfg = cfg
  }

  get name(): string {
    return `${this.root.split('/').filter(Boolean).pop() ?? this.root} — ${this.cfg.host}`
  }

  private abs(path: string): string {
    return path ? `${this.root}/${path}` : this.root
  }

  async walk(): Promise<VaultScan> {
    const mdIndex = new Map<string, string>()
    const assetIndex = new Map<string, string>()
    const tree = await this.walkDir('', mdIndex, assetIndex)
    return { tree, mdIndex, assetIndex }
  }

  // ponytail: directories walked sequentially; parallelize if huge vaults feel slow
  private async walkDir(
    prefix: string,
    mdIndex: Map<string, string>,
    assetIndex: Map<string, string>,
  ): Promise<TreeNode[]> {
    const nodes: TreeNode[] = []
    for (const entry of await this.sftp.list(this.abs(prefix))) {
      if (entry.name.startsWith('.')) continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDir) {
        const children = await this.walkDir(path, mdIndex, assetIndex)
        if (children.length > 0) {
          nodes.push({ name: entry.name, path, kind: 'dir', children })
        }
      } else if (entry.name.endsWith('.md')) {
        const key = entry.name.slice(0, -3).toLowerCase()
        if (!mdIndex.has(key)) mdIndex.set(key, path)
        nodes.push({ name: entry.name.slice(0, -3), path, kind: 'file' })
      } else if (entry.isFile && !assetIndex.has(entry.name.toLowerCase())) {
        assetIndex.set(entry.name.toLowerCase(), path)
      }
    }
    nodes.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
    )
    return nodes
  }

  async read(path: string): Promise<{ text: string; mtime: number }> {
    const [data, st] = await Promise.all([
      this.sftp.readFile(this.abs(path)),
      this.sftp.stat(this.abs(path)),
    ])
    return { text: data.toString('utf8'), mtime: st.mtime }
  }

  async mtime(path: string): Promise<number> {
    return (await this.sftp.stat(this.abs(path))).mtime
  }

  async write(path: string, text: string): Promise<number> {
    await this.sftp.writeFile(this.abs(path), Buffer.from(text, 'utf8'))
    return this.mtime(path)
  }

  async create(dirPath = ''): Promise<string> {
    for (let n = 0; ; n++) {
      const name = n === 0 ? 'Untitled.md' : `Untitled ${n}.md`
      const path = dirPath ? `${dirPath}/${name}` : name
      if (!(await this.sftp.exists(this.abs(path)))) {
        await this.write(path, '')
        return path
      }
    }
  }

  async delete(path: string): Promise<void> {
    await this.sftp.remove(this.abs(path))
  }

  async rename(path: string, newPath: string): Promise<void> {
    await this.sftp.rename(this.abs(path), this.abs(newPath))
  }

  async assetFile(path: string): Promise<Blob> {
    const data = await this.sftp.readFile(this.abs(path))
    return new Blob([Uint8Array.from(data)])
  }

  async close(): Promise<void> {
    await this.session.close(SshDisconnectReason.byApplication).catch(() => {})
  }
}
