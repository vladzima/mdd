#!/usr/bin/env node
// Self-check for server.mjs: auth, CRUD, traversal rejection. Run: node test_agent.mjs
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdd-agent-'))
await fs.mkdir(path.join(dir, 'sub'))
await fs.writeFile(path.join(dir, 'sub', 'note.md'), '# hi')
await fs.writeFile(path.join(dir, '.secret'), 'hidden')

const child = spawn(process.execPath, [new URL('server.mjs', import.meta.url).pathname, dir, '0'], {
  env: { ...process.env, MDD_TOKEN: 'testtoken', MDD_ORIGIN: 'https://edit.computer' },
})
const base = await new Promise((resolve, reject) => {
  child.stdout.on('data', (d) => {
    const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(String(d))
    if (m) resolve(m[1])
  })
  child.stderr.on('data', (d) => reject(new Error(String(d))))
  setTimeout(() => reject(new Error('agent did not start')), 5000)
})

const auth = { authorization: 'Bearer testtoken' }
const f = (p, init = {}) => fetch(base + p, { ...init, headers: { ...auth, ...init.headers } })

try {
  // auth required
  assert.equal((await fetch(`${base}/list`)).status, 401)
  assert.equal((await fetch(`${base}/list`, { headers: { authorization: 'Bearer nope' } })).status, 401)

  // CORS preflight needs no auth
  const pre = await fetch(`${base}/file`, {
    method: 'OPTIONS',
    headers: { origin: 'https://edit.computer' },
  })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://edit.computer')

  // list: has the note, skips dotfiles
  const list = await (await f('/list')).json()
  assert.deepEqual(list.map((e) => e.path), ['sub/note.md'])
  assert.equal(typeof list[0].mtime, 'number')

  // read + mtime header
  const got = await f('/file?path=sub/note.md')
  assert.equal(await got.text(), '# hi')
  assert.equal(got.headers.get('x-mtime'), String(list[0].mtime))

  // write (creates parent dirs) then read back
  const put = await f('/file?path=new/deep/a.md', { method: 'PUT', body: 'hello' })
  const { mtime } = await put.json()
  assert.equal(typeof mtime, 'number')
  assert.equal(await (await f('/file?path=new/deep/a.md')).text(), 'hello')

  // delete
  assert.equal((await f('/file?path=new/deep/a.md', { method: 'DELETE' })).status, 204)
  assert.equal((await f('/file?path=new/deep/a.md')).status, 404)

  // path jail
  for (const bad of ['../etc/passwd', 'sub/../../x', '.secret', 'sub/.hidden', '/etc/passwd']) {
    assert.equal((await f(`/file?path=${encodeURIComponent(bad)}`)).status, 400, bad)
  }

  console.log('agent self-check OK')
} finally {
  child.kill()
  await fs.rm(dir, { recursive: true, force: true })
}
