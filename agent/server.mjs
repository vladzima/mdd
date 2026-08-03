#!/usr/bin/env node
// mdd remote vault agent — single file, no deps.
// Usage: MDD_TOKEN=<secret> node server.mjs /path/to/vault [port]
// Binds to localhost only; expose it with `cloudflared tunnel run`.

import http from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '.')
const port = process.argv[3] !== undefined ? Number(process.argv[3]) : 8443
const token = process.env.MDD_TOKEN
const origins = new Set(
  (process.env.MDD_ORIGIN ?? 'https://edit.computer').split(',').map((s) => s.trim()),
)
const MAX_BODY = 50 * 1024 * 1024

if (!token) {
  console.error('MDD_TOKEN env var is required')
  process.exit(1)
}
if (!(await fs.stat(root).catch(() => null))?.isDirectory()) {
  console.error(`not a directory: ${root}`)
  process.exit(1)
}

const digest = (s) => createHash('sha256').update(s).digest()
const tokenDigest = digest(token)

function authorized(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
  return m ? timingSafeEqual(digest(m[1]), tokenDigest) : false
}

// Vault-relative path → absolute, or null. Rejects '..', dot segments, escapes.
function safePath(p) {
  if (!p || p.split('/').some((seg) => !seg || seg.startsWith('.'))) return null
  const abs = path.resolve(root, p)
  return abs.startsWith(root + path.sep) ? abs : null
}

async function listFiles(dir, prefix, out) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) await listFiles(abs, `${prefix}${entry.name}/`, out)
    else if (entry.isFile()) {
      const st = await fs.stat(abs)
      out.push({ path: prefix + entry.name, mtime: Math.round(st.mtimeMs) })
    }
  }
  return out
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) reject(new Error('body too large'))
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && origins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, DELETE')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Expose-Headers', 'X-Mtime')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  const done = (status, body, headers) => {
    res.writeHead(status, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  try {
    if (!authorized(req)) return done(401, 'unauthorized')
    const url = new URL(req.url, 'http://x')

    if (url.pathname === '/list' && req.method === 'GET') {
      const files = await listFiles(root, '', [])
      return done(200, JSON.stringify(files), { 'Content-Type': 'application/json' })
    }

    if (url.pathname === '/file') {
      const abs = safePath(url.searchParams.get('path'))
      if (!abs) return done(400, 'bad path')
      if (req.method === 'GET' || req.method === 'HEAD') {
        const st = await fs.stat(abs)
        if (!st.isFile()) return done(404, 'not a file')
        return done(200, req.method === 'GET' ? await fs.readFile(abs) : undefined, {
          'Content-Type': 'application/octet-stream',
          'X-Mtime': String(Math.round(st.mtimeMs)),
        })
      }
      if (req.method === 'PUT') {
        const body = await readBody(req)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, body)
        const st = await fs.stat(abs)
        return done(200, JSON.stringify({ mtime: Math.round(st.mtimeMs) }), {
          'Content-Type': 'application/json',
        })
      }
      if (req.method === 'DELETE') {
        await fs.unlink(abs)
        return done(204)
      }
    }

    done(404, 'not found')
  } catch (err) {
    done(err?.code === 'ENOENT' ? 404 : 500, String(err?.message ?? err))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mdd agent serving ${root} on http://127.0.0.1:${server.address().port}`)
})
