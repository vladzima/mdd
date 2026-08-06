// Minimal SFTP v3 client over an SSH channel — only the ops the vault needs.
// Protocol: RFC draft-ietf-secsh-filexfer-02.

import { Buffer } from 'buffer'
import type { SshChannel } from '@microsoft/dev-tunnels-ssh'

const FXP = {
  INIT: 1,
  VERSION: 2,
  OPEN: 3,
  CLOSE: 4,
  READ: 5,
  WRITE: 6,
  OPENDIR: 11,
  READDIR: 12,
  REMOVE: 13,
  MKDIR: 14,
  RMDIR: 15,
  REALPATH: 16,
  STAT: 17,
  RENAME: 18,
  STATUS: 101,
  HANDLE: 102,
  DATA: 103,
  NAME: 104,
  ATTRS: 105,
} as const

const STATUS_OK = 0
const STATUS_EOF = 1
const STATUS_TEXT: Record<number, string> = {
  2: 'no such file',
  3: 'permission denied',
  4: 'failure',
  8: 'operation unsupported',
}

// open flags
const READ = 0x1
const WRITE = 0x2
const CREAT = 0x8
const TRUNC = 0x10

const ATTR_SIZE = 0x1
const ATTR_UIDGID = 0x2
const ATTR_PERMISSIONS = 0x4
const ATTR_ACMODTIME = 0x8

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFREG = 0o100000

const CHUNK = 32 * 1024 // max payload most servers accept per READ/WRITE

export interface SftpEntry {
  name: string
  isDir: boolean
  isFile: boolean
  mtime: number // ms
}

export class SftpError extends Error {
  readonly code: number
  constructor(code: number, op: string) {
    super(`sftp: ${STATUS_TEXT[code] ?? `error ${code}`} (${op})`)
    this.code = code
  }
}

function str(s: string): Buffer {
  const body = Buffer.from(s, 'utf8')
  const head = Buffer.alloc(4)
  head.writeUInt32BE(body.length)
  return Buffer.concat([head, body])
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

function u64(n: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeUInt32BE(Math.floor(n / 2 ** 32), 0)
  b.writeUInt32BE(n >>> 0, 4)
  return b
}

class Reader {
  private buf: Buffer
  private pos: number
  constructor(buf: Buffer, pos = 0) {
    this.buf = buf
    this.pos = pos
  }
  u32(): number {
    const v = this.buf.readUInt32BE(this.pos)
    this.pos += 4
    return v
  }
  str(): string {
    const len = this.u32()
    const s = this.buf.subarray(this.pos, this.pos + len).toString('utf8')
    this.pos += len
    return s
  }
  bytes(): Buffer {
    const len = this.u32()
    const b = this.buf.subarray(this.pos, this.pos + len)
    this.pos += len
    return b
  }
  // Returns { mode, mtime(ms) }; advances past the ATTRS structure.
  attrs(): { mode: number; mtime: number } {
    const flags = this.u32()
    if (flags & ATTR_SIZE) this.pos += 8
    if (flags & ATTR_UIDGID) this.pos += 8
    const mode = flags & ATTR_PERMISSIONS ? this.u32() : 0
    let mtime = 0
    if (flags & ATTR_ACMODTIME) {
      this.pos += 4 // atime
      mtime = this.u32() * 1000
    }
    if (flags & 0x80000000) {
      // extended pairs
      const count = this.u32()
      for (let i = 0; i < count; i++) {
        this.bytes()
        this.bytes()
      }
    }
    return { mode, mtime }
  }
  get remaining(): number {
    return this.buf.length - this.pos
  }
}

interface Pending {
  resolve: (r: { type: number; reader: Reader }) => void
  reject: (e: unknown) => void
}

export class Sftp {
  private channel: SshChannel
  private inbox: Buffer = Buffer.alloc(0)
  private pending = new Map<number, Pending>()
  private nextId = 1
  private closed = false

  private constructor(channel: SshChannel) {
    this.channel = channel
  }

  static async open(channel: SshChannel): Promise<Sftp> {
    const sftp = new Sftp(channel)
    channel.onDataReceived((data) => {
      sftp.onData(Buffer.from(data))
      channel.adjustWindow(data.length)
    })
    channel.onClosed(() => {
      sftp.closed = true
      for (const p of sftp.pending.values()) p.reject(new Error('sftp: channel closed'))
      sftp.pending.clear()
    })
    // INIT carries a version, not a request id, so the VERSION reply is matched by type.
    const version = new Promise<void>((resolve, reject) => {
      sftp.pending.set(-1, {
        resolve: () => resolve(),
        reject,
      })
      setTimeout(() => reject(new Error('sftp: server did not respond to INIT')), 15000)
    })
    await sftp.sendPacket(FXP.INIT, u32(3))
    await version
    return sftp
  }

  private onData(chunk: Buffer): void {
    this.inbox = this.inbox.length ? Buffer.concat([this.inbox, chunk]) : chunk
    for (;;) {
      if (this.inbox.length < 4) return
      const len = this.inbox.readUInt32BE(0)
      if (this.inbox.length < 4 + len) return
      const packet = this.inbox.subarray(4, 4 + len)
      this.inbox = this.inbox.subarray(4 + len)
      const type = packet[0]
      if (type === FXP.VERSION) {
        this.pending.get(-1)?.resolve({ type, reader: new Reader(packet, 1) })
        this.pending.delete(-1)
        continue
      }
      const reader = new Reader(packet, 1)
      const id = reader.u32()
      const p = this.pending.get(id)
      if (p) {
        this.pending.delete(id)
        p.resolve({ type, reader })
      }
    }
  }

  private async sendPacket(type: number, payload: Buffer): Promise<void> {
    const head = Buffer.alloc(5)
    head.writeUInt32BE(payload.length + 1, 0)
    head[4] = type
    await this.channel.send(Buffer.concat([head, payload]))
  }

  private request(type: number, payload: Buffer, op: string): Promise<{ type: number; reader: Reader }> {
    if (this.closed) return Promise.reject(new Error('sftp: closed'))
    const id = this.nextId++
    const done = new Promise<{ type: number; reader: Reader }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    void this.sendPacket(type, Buffer.concat([u32(id), payload])).catch((e) => {
      this.pending.get(id)?.reject(e)
      this.pending.delete(id)
    })
    return done.then((res) => {
      if (res.type === FXP.STATUS) {
        const code = res.reader.u32()
        if (code !== STATUS_OK && code !== STATUS_EOF) throw new SftpError(code, op)
      }
      return res
    })
  }

  async realpath(path: string): Promise<string> {
    const { reader } = await this.request(FXP.REALPATH, str(path), `realpath ${path}`)
    reader.u32() // count (always 1)
    return reader.str()
  }

  async list(path: string): Promise<SftpEntry[]> {
    const opened = await this.request(FXP.OPENDIR, str(path), `opendir ${path}`)
    const handle = opened.reader.bytes()
    const entries: SftpEntry[] = []
    try {
      for (;;) {
        const res = await this.request(
          FXP.READDIR,
          Buffer.concat([u32(handle.length), handle]),
          `readdir ${path}`,
        )
        if (res.type === FXP.STATUS) break // EOF
        const count = res.reader.u32()
        for (let i = 0; i < count; i++) {
          const name = res.reader.str()
          res.reader.str() // longname
          const { mode, mtime } = res.reader.attrs()
          if (name === '.' || name === '..') continue
          entries.push({
            name,
            isDir: (mode & S_IFMT) === S_IFDIR,
            isFile: (mode & S_IFMT) === S_IFREG,
            mtime,
          })
        }
      }
    } finally {
      await this.closeHandle(handle)
    }
    return entries
  }

  async stat(path: string): Promise<{ mode: number; mtime: number }> {
    const { reader } = await this.request(FXP.STAT, str(path), `stat ${path}`)
    return reader.attrs()
  }

  async readFile(path: string): Promise<Buffer> {
    const opened = await this.request(
      FXP.OPEN,
      Buffer.concat([str(path), u32(READ), u32(0)]),
      `open ${path}`,
    )
    const handle = opened.reader.bytes()
    const parts: Buffer[] = []
    try {
      for (let offset = 0; ; ) {
        const res = await this.request(
          FXP.READ,
          Buffer.concat([u32(handle.length), handle, u64(offset), u32(CHUNK)]),
          `read ${path}`,
        )
        if (res.type === FXP.STATUS) break // EOF
        const data = res.reader.bytes()
        parts.push(Buffer.from(data))
        offset += data.length
        if (data.length < CHUNK) break
      }
    } finally {
      await this.closeHandle(handle)
    }
    return Buffer.concat(parts)
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    const opened = await this.request(
      FXP.OPEN,
      Buffer.concat([str(path), u32(WRITE | CREAT | TRUNC), u32(0)]),
      `open ${path}`,
    )
    const handle = opened.reader.bytes()
    try {
      for (let offset = 0; offset < data.length || offset === 0; offset += CHUNK) {
        const slice = data.subarray(offset, offset + CHUNK)
        await this.request(
          FXP.WRITE,
          Buffer.concat([u32(handle.length), handle, u64(offset), u32(slice.length), slice]),
          `write ${path}`,
        )
        if (data.length === 0) break
      }
    } finally {
      await this.closeHandle(handle)
    }
  }

  async remove(path: string): Promise<void> {
    await this.request(FXP.REMOVE, str(path), `remove ${path}`)
  }

  async rename(from: string, to: string): Promise<void> {
    await this.request(FXP.RENAME, Buffer.concat([str(from), str(to)]), `rename ${from}`)
  }

  async mkdir(path: string): Promise<void> {
    // trailing u32(0) is an empty ATTRS block: let the server pick the mode
    await this.request(FXP.MKDIR, Buffer.concat([str(path), u32(0)]), `mkdir ${path}`)
  }

  // Fails on a non-empty directory, which is the behaviour the folder UI relies on.
  async rmdir(path: string): Promise<void> {
    await this.request(FXP.RMDIR, str(path), `rmdir ${path}`)
  }

  async exists(path: string): Promise<boolean> {
    return this.stat(path).then(
      () => true,
      () => false,
    )
  }

  private async closeHandle(handle: Buffer): Promise<void> {
    await this.request(FXP.CLOSE, Buffer.concat([u32(handle.length), handle]), 'close').catch(
      () => {},
    )
  }
}
