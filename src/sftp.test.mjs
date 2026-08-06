#!/usr/bin/env node
// Self-check for the SFTP client + SshVault against a real sshd.
// Run via `npm test`, which injects `self` before the SSH library loads so this
// exercises the same WebCrypto path browsers take (the guard below enforces it).
// Spins up a throwaway sshd on 127.0.0.1, connects over TCP (the browser uses the
// same code over the /relay WebSocket), exercises the Vault ops.
// Run: node src/sftp.test.mjs

import assert from 'node:assert'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'


const {
  SshClientSession,
  SshSessionConfiguration,
  NodeStream,
  CommandRequestMessage,
} = await import('@microsoft/dev-tunnels-ssh')
const { importKeyFile } = await import('@microsoft/dev-tunnels-ssh-keys')
const { SshAlgorithms } = await import('@microsoft/dev-tunnels-ssh')
const { Sftp } = await import('./sftp.ts')
const { unusableKeyReason } = await import('./ssh.ts')
const { SshVault } = await import('./ssh.ts')

// Ask the OS for a free port so parallel/leftover runs can't collide.
// Guard: if this ever says Node*, the test stopped covering what browsers run.
assert.match(
  Object.values(SshAlgorithms.keyExchange).find(Boolean).constructor.name,
  /^Web/,
  'expected the WebCrypto implementation',
)

const PORT = await new Promise((resolve) => {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdd-sftp-'))
const vault = path.join(dir, 'vault')
await fs.mkdir(path.join(vault, 'folder'), { recursive: true })
await fs.writeFile(path.join(vault, 'Root.md'), '# root note')
await fs.writeFile(path.join(vault, 'folder', 'Nested.md'), 'nested body')
await fs.writeFile(path.join(vault, 'folder', 'pic.png'), Buffer.from([1, 2, 3, 4]))
await fs.mkdir(path.join(vault, 'empty'))
await fs.writeFile(path.join(vault, '.hidden.md'), 'skip me')

execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-f', path.join(dir, 'id'), '-N', ''])
execFileSync('ssh-keygen', ['-q', '-t', 'rsa', '-f', path.join(dir, 'hostkey'), '-N', ''])
// The client library speaks rsa/ecdsa, not ed25519 — use an RSA user key.
execFileSync('ssh-keygen', ['-q', '-t', 'rsa', '-b', '2048', '-m', 'PEM', '-f', path.join(dir, 'user'), '-N', ''])
await fs.writeFile(
  path.join(dir, 'sshd_config'),
  `Port ${PORT}
ListenAddress 127.0.0.1
HostKey ${dir}/hostkey
AuthorizedKeysFile ${dir}/user.pub
PasswordAuthentication no
UsePAM no
StrictModes no
Subsystem sftp internal-sftp
`,
)
const sshd = spawn('/usr/sbin/sshd', ['-D', '-f', path.join(dir, 'sshd_config')], { stdio: 'ignore' })

async function connectWithRetry() {
  for (let i = 0; ; i++) {
    try {
      return await new Promise((resolve, reject) => {
        const s = net.connect(PORT, '127.0.0.1')
        s.on('connect', () => resolve(s))
        s.on('error', reject)
      })
    } catch (err) {
      if (i >= 40) throw err
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}
const socket = await connectWithRetry()

const session = new SshClientSession(new SshSessionConfiguration())
session.onAuthenticating((e) => {
  e.authenticationPromise = Promise.resolve({}) // host key checked in the browser path
})

try {
  await session.connect(new NodeStream(socket))
  const key = await importKeyFile(path.join(dir, 'user'))
  assert.ok(await session.authenticate({ username: os.userInfo().username, publicKeys: [key] }), 'auth')

  const channel = await session.openChannel()
  const req = new CommandRequestMessage()
  req.requestType = 'subsystem'
  req.command = 'sftp'
  assert.ok(await channel.request(req), 'sftp subsystem')
  const sftp = await Sftp.open(channel)

  const root = await sftp.realpath(vault)
  const v = new SshVault(session, sftp, root, { host: 'localhost', port: PORT, username: 'x', path: vault })

  // walk: tree shape, dotfiles skipped, empty dirs listed, indexes built
  const scan = await v.walk()
  assert.deepEqual(
    scan.tree.map((n) => `${n.kind}:${n.path}`),
    ['dir:empty', 'dir:folder', 'file:Root.md'],
    'tree',
  )
  assert.deepEqual(
    scan.tree[1].children.map((n) => n.path),
    ['folder/Nested.md'],
  )
  assert.equal(scan.mdIndex.get('nested'), 'folder/Nested.md')
  assert.equal(scan.assetIndex.get('pic.png'), 'folder/pic.png')
  // every node carries an mtime, or sorting by date edited has nothing to sort on
  const rootNote = scan.tree.find((n) => n.path === 'Root.md')
  assert.ok(Math.abs(rootNote.mtime - Date.now()) < 60_000, `Root.md mtime (got ${rootNote.mtime})`)

  // read
  const got = await v.read('folder/Nested.md')
  assert.equal(got.text, 'nested body')
  assert.ok(got.mtime > 0 && Math.abs(got.mtime - Date.now()) < 60_000, 'mtime is ms')

  // write + mtime advances
  const mtime = await v.write('folder/Nested.md', 'updated body')
  assert.equal(await fs.readFile(path.join(vault, 'folder', 'Nested.md'), 'utf8'), 'updated body')
  assert.equal(await v.mtime('folder/Nested.md'), mtime)

  // large write crosses the 32 KiB chunk boundary
  const big = 'x'.repeat(100_000)
  await v.write('big.md', big)
  assert.equal((await v.read('big.md')).text, big, 'chunked write/read')

  // unicode round-trips as bytes, not chars
  await v.write('uni.md', 'héllo — 日本語')
  assert.equal((await v.read('uni.md')).text, 'héllo — 日本語')

  // create picks a free name, twice
  assert.equal(await v.create(), 'Untitled.md')
  assert.equal(await v.create(), 'Untitled 1.md')
  assert.equal(await v.create('folder'), 'folder/Untitled.md')

  // native rename
  await v.move('big.md', 'renamed.md')
  assert.equal((await v.read('renamed.md')).text, big)

  // folders: make, move a note into one, rename the folder, refuse to delete it
  // while it still holds something, then delete it once it is empty
  await v.mkdir('made')
  assert.equal(await v.exists('made'), true, 'mkdir')
  await v.move('renamed.md', 'made/renamed.md')
  assert.equal((await v.read('made/renamed.md')).text, big, 'note moved into the folder')
  assert.equal(await v.exists('renamed.md'), false, 'and left its old home')
  await v.move('made', 'made2')
  assert.equal((await v.read('made2/renamed.md')).text, big, 'folder rename takes its notes along')
  await assert.rejects(() => v.rmdir('made2'), /failure|permission/i, 'rmdir refuses a full folder')
  await v.delete('made2/renamed.md')
  await v.rmdir('made2')
  assert.equal(await v.exists('made2'), false, 'rmdir')

  // asset read as bytes
  const blob = await v.assetFile('folder/pic.png')
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3, 4]))

  // delete
  await v.delete('Untitled.md')
  assert.equal(await sftp.exists(`${root}/Untitled.md`), false)

  // missing file rejects rather than hanging
  await assert.rejects(() => v.read('nope.md'), /no such file/)

  // Key formats: ssh-keygen's default output is unusable here, and the library
  // misreports it as a decryption failure — check we explain it instead.
  execFileSync('ssh-keygen', ['-q', '-t', 'rsa', '-b', '2048', '-f', path.join(dir, 'openssh_fmt'), '-N', ''])
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-f', path.join(dir, 'ed'), '-N', ''])
  const openssh = await fs.readFile(path.join(dir, 'openssh_fmt'), 'utf8')
  const ed = await fs.readFile(path.join(dir, 'ed'), 'utf8')
  const pem = await fs.readFile(path.join(dir, 'user'), 'utf8')
  assert.match(unusableKeyReason(openssh), /OpenSSH format/, 'openssh-format key explained')
  assert.match(unusableKeyReason(ed), /ed25519/, 'ed25519 key explained')
  assert.equal(unusableKeyReason(pem), null, 'PEM key accepted')

  // Key encryption: PKCS#8 with the SHA-1 PRF (macOS default) must be explained,
  // not surfaced as the parser's "Read out of bounds".
  const { importKeyBytes } = await import('@microsoft/dev-tunnels-ssh-keys')
  execFileSync('openssl', ['pkcs8', '-topk8', '-in', path.join(dir, 'user'), '-out', path.join(dir, 'sha1prf'),
    '-v2', 'aes-256-cbc', '-v2prf', 'hmacWithSHA1', '-passout', 'pass:pw'])
  const sha1Err = await importKeyBytes(Buffer.from(await fs.readFile(path.join(dir, 'sha1prf'))), 'pw').then(
    () => null,
    (e) => e.message,
  )
  assert.match(sha1Err ?? '', /out of bounds/, 'library still reports the SHA-1 PRF this way')

  console.log('sftp/ssh vault self-check OK')
} finally {
  await session.close().catch(() => {})
  socket.destroy()
  sshd.kill()
  await fs.rm(dir, { recursive: true, force: true })
}
process.exit(0)
