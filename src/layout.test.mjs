#!/usr/bin/env node
// Self-check for touch resizing and the phone layout, driven in real Chromium.
// Inspection and jsdom both miss this class of bug, so the whole stack runs for
// real: a throwaway sshd holds a vault, a local server serves ./dist plus a
// WebSocket→TCP /relay (same shape as the Worker), and the browser connects to
// it over SSH exactly as it would against edit.computer.
// Run: npm run build && npm run test:layout

import assert from 'node:assert'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import('playwright-core').catch(() => {
  console.error('needs: npm i --no-save playwright-core @playwright/browser-chromium')
  process.exit(1)
})
const { WebSocketServer } = await import('ws')

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
await fs.access(path.join(dist, 'index.html')).catch(() => {
  console.error('no dist/ — run `npm run build` first')
  process.exit(1)
})

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })

// --- vault + sshd ---

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdd-layout-'))
const vault = path.join(dir, 'vault')
await fs.mkdir(path.join(vault, 'folder'), { recursive: true })
await fs.writeFile(path.join(vault, 'Root.md'), '# Root\n\nbody\n\n## Second\n\nmore\n')
await fs.writeFile(path.join(vault, 'folder', 'Nested.md'), '# Nested\n\nnested body\n')

const SSH_PORT = await freePort()
execFileSync('ssh-keygen', ['-q', '-t', 'rsa', '-f', path.join(dir, 'hostkey'), '-N', ''])
execFileSync('ssh-keygen', ['-q', '-t', 'rsa', '-b', '2048', '-m', 'PEM', '-f', path.join(dir, 'user'), '-N', ''])
await fs.writeFile(
  path.join(dir, 'sshd_config'),
  `Port ${SSH_PORT}
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

// --- static server + relay ---

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://x').pathname
  const file = path.join(dist, name === '/' ? 'index.html' : name)
  const body = await fs.readFile(file).catch(() => null)
  if (body) {
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } else {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(await fs.readFile(path.join(dist, 'index.html'))) // SPA fallback
  }
})
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname !== '/relay') return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => {
    const tcp = net.connect(Number(url.searchParams.get('port')), url.searchParams.get('host'))
    ws.on('message', (data) => tcp.write(data))
    tcp.on('data', (chunk) => ws.send(chunk))
    const bye = () => {
      tcp.destroy()
      ws.close()
    }
    ws.on('close', bye)
    tcp.on('close', bye)
    tcp.on('error', bye)
  })
})
const HTTP_PORT = await freePort()
await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r))
const origin = `http://127.0.0.1:${HTTP_PORT}`

// --- browser ---

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const username = os.userInfo().username
const keyFile = path.join(dir, 'user')

// Chromium turns emulated touch into the pointer events the app listens for;
// playwright's touchscreen only taps, so drags go through raw CDP.
async function touchDrag(page, fromX, fromY, toX, toY) {
  const cdp = await page.context().newCDPSession(page)
  const at = (x, y) => [{ x, y, radiusX: 12, radiusY: 12, force: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(fromX, fromY) })
  for (let i = 1; i <= 5; i++) {
    const t = i / 5
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: at(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t),
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

async function connect(page) {
  await page.goto(origin)
  await page.click('button:has-text("Connect over SSH")')
  await page.fill('input[placeholder^="Host"]', '127.0.0.1')
  await page.fill('.port', String(SSH_PORT))
  await page.fill('input[placeholder="Username"]', username)
  await page.setInputFiles('input[type=file]', keyFile)
  await page.fill('input[placeholder^="Vault path"]', vault)
  await page.click('.connect button.primary')
  await page.waitForSelector('.sidebar', { timeout: 30000 })
}

const width = (sel) => (page) => page.$eval(sel, (el) => el.getBoundingClientRect().width)

try {
  // A share card that 404s is invisible until someone posts the link, so check
  // the tag and the file it points at agree.
  const html = await (await fetch(origin)).text()
  const og = /<meta property="og:image" content="https:\/\/edit\.computer(\/[^"]+)"/.exec(html)
  assert.ok(og, 'og:image tag present with an absolute URL')
  const card = await fetch(`${origin}${og[1]}`)
  assert.equal(card.status, 200, `${og[1]} is served`)
  assert.equal(card.headers.get('content-type'), 'image/png')
  assert.ok((await card.arrayBuffer()).byteLength > 10_000, 'card is a real image')

  // === iPad: landscape, touch, desktop layout with both resizers ===
  const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true })
  const pad = await tablet.newPage()
  await connect(pad)
  await pad.click('.row.file:has-text("Root")') // heading-bearing note, so the outline renders
  await pad.waitForSelector('.outline')

  assert.equal(await width('.sidebar')(pad), 240, 'sidebar starts at its default width')

  // the actual bug: a finger on the grab strip did nothing, because it only
  // ever listened for mousemove
  await touchDrag(pad, 240, 400, 350, 400)
  const dragged = await width('.sidebar')(pad)
  assert.ok(Math.abs(dragged - 350) <= 4, `touch drag resized the sidebar (got ${dragged})`)
  assert.equal(await pad.evaluate(() => localStorage.getItem('mdd:sidebar-width')), '350', 'width persisted')

  // clamps hold on touch too
  await touchDrag(pad, 350, 400, 900, 400)
  assert.equal(await width('.sidebar')(pad), 420, 'sidebar clamps at 420')

  // right-hand outline resizer, dragged leftwards to widen
  const outlineBefore = await width('.outline')(pad)
  await touchDrag(pad, 1024 - outlineBefore, 400, 1024 - outlineBefore - 90, 400)
  const outlineAfter = await width('.outline')(pad)
  assert.ok(Math.abs(outlineAfter - (outlineBefore + 90)) <= 4, `outline touch-resized (got ${outlineAfter})`)

  // mouse must still work — pointer events cover both, but prove it
  await pad.mouse.move(420, 400)
  await pad.mouse.down()
  await pad.mouse.move(300, 400, { steps: 5 })
  await pad.mouse.up()
  const byMouse = await width('.sidebar')(pad)
  assert.ok(Math.abs(byMouse - 300) <= 4, `mouse drag still resizes (got ${byMouse})`)

  // touch targets grew, and hover-only actions are reachable without a hover
  assert.equal(await pad.$eval('.row.file', (el) => getComputedStyle(el).height), '38px', 'coarse row height')
  assert.equal(
    await pad.$eval('.row-action', (el) => getComputedStyle(el).visibility),
    'visible',
    'row actions visible without hover',
  )

  // === phone: drawer layout ===
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  })
  const ph = await phone.newPage()
  await connect(ph)

  assert.equal(await ph.$$eval('.outline', (els) => els.length), 0, 'outline dropped on a phone')
  const drawer = await ph.$eval('.sidebar', (el) => ({
    position: getComputedStyle(el).position,
    width: el.getBoundingClientRect().width,
  }))
  assert.equal(drawer.position, 'fixed', 'sidebar overlays instead of taking a column')
  assert.ok(drawer.width <= 0.84 * 390 + 1, `drawer is at most 84vw (got ${drawer.width})`)
  assert.equal(await width('.main')(ph), 390, 'editor keeps the full width underneath')
  assert.ok(await ph.isVisible('.scrim'), 'scrim shown behind the drawer')
  assert.equal(
    await ph.evaluate(() => document.documentElement.scrollWidth),
    390,
    'nothing overflows sideways',
  )

  // tapping a note gets the drawer out of the way
  await ph.tap('.row.file:has-text("Root")')
  await ph.waitForSelector('.sidebar', { state: 'detached' })
  assert.ok(!(await ph.isVisible('.scrim')), 'scrim gone with the drawer')

  // and the toggle brings it back, then the scrim dismisses it
  await ph.tap('.sidebar-toggle')
  await ph.waitForSelector('.sidebar')
  await ph.tap('.scrim', { position: { x: 360, y: 500 } }) // to the right of the drawer
  await ph.waitForSelector('.sidebar', { state: 'detached' })

  assert.equal(
    await ph.$eval('.cm-content', (el) => getComputedStyle(el).paddingLeft),
    '16px',
    'editor padding tightened for the phone',
  )

  // rename on a phone goes through the platform dialog, not the inline field
  // that the on-screen keyboard would cover
  await ph.tap('.sidebar-toggle')
  await ph.waitForSelector('.sidebar')
  let asked = null
  ph.once('dialog', (d) => {
    asked = { type: d.type(), value: d.defaultValue() }
    return d.accept('Renamed on phone')
  })
  await ph.tap('.row.file:has-text("Root") [title="Rename"]')
  // the drawer must survive the rename — it closes on opening a note, not on
  // any change of the active path
  await ph.waitForSelector('.row.file:has-text("Renamed on phone")')
  assert.equal(asked?.type, 'prompt', 'a prompt dialog was used')
  assert.equal(asked.value, 'Root', 'prefilled with the current name')
  assert.equal(await ph.$$eval('.rename-input', (e) => e.length), 0, 'no inline field on a phone')
  await fs.access(path.join(vault, 'Renamed on phone.md'))

  // === desktop: hover is the only thing that hides row actions, so this is
  // where a note you just made can end up with no visible way to rename it ===
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const dk = await desk.newPage()
  await connect(dk)
  await dk.click('.sidebar-header .icon-btn[title="New note"]')
  await dk.waitForSelector('.row.file.active:has-text("Untitled")')

  const active = await dk.$$('.row.file.active')
  assert.equal(active.length, 2, 'the new note is listed under Recent and in the tree')
  for (const row of active) {
    const rename = await row.$('[title="Rename"]')
    assert.ok(rename, 'every listing of a note offers rename')
    assert.ok(await rename.isVisible(), 'the open note shows its actions without a hover')
  }
  const idle = await dk.$('.row.file:not(.active)')
  assert.equal(
    await (await idle.$('[title="Rename"]')).isVisible(),
    false,
    'notes you are not editing stay quiet until hovered',
  )

  // rename through the Recent copy, which used to render a bare name
  await (await active[0].$('[title="Rename"]')).click()
  const field = await dk.waitForSelector('.rename-input')
  await field.fill('Renamed by test')
  await field.press('Enter')
  await dk.waitForSelector('.row.file:has-text("Renamed by test")')
  await fs.access(path.join(vault, 'Renamed by test.md'))

  // a new note names itself from its first H1, once that line is finished
  const names = () => dk.$$eval('.row-name', (els) => els.map((e) => e.textContent))
  await dk.click('.sidebar-header .icon-btn[title="New note"]')
  await dk.waitForSelector('.row.file.active:has-text("Untitled")')
  await dk.keyboard.type('# Kitchen notes')
  await dk.waitForTimeout(1200) // autosave is 800ms idle
  assert.ok(
    (await names()).includes('Untitled'),
    'still Untitled while the cursor sits on the title line',
  )
  await dk.keyboard.type('\nbody')
  await dk.waitForSelector('.row.file:has-text("Kitchen notes")')
  await fs.access(path.join(vault, 'Kitchen notes.md'))
  assert.ok(!(await names()).includes('Untitled'), 'the placeholder name is gone')

  // a second note with the same heading must not overwrite the first
  await dk.click('.sidebar-header .icon-btn[title="New note"]')
  await dk.waitForSelector('.row.file.active:has-text("Untitled")')
  await dk.keyboard.type('# Kitchen notes\nsomething else')
  await dk.waitForTimeout(1500)
  assert.ok((await names()).includes('Untitled'), 'a taken name leaves the note as Untitled')
  assert.equal(
    await fs.readFile(path.join(vault, 'Kitchen notes.md'), 'utf8'),
    '# Kitchen notes\nbody',
    'the original note was not clobbered',
  )

  if (process.env.SHOTS) {
    const shot = (page, name) => page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })
    // the phone rename test leaves the drawer open
    if (await ph.isVisible('.scrim')) {
      await ph.tap('.scrim', { position: { x: 360, y: 500 } })
      await ph.waitForSelector('.sidebar', { state: 'detached' })
    }
    await shot(ph, 'phone-note')
    await ph.tap('.sidebar-toggle')
    await ph.waitForSelector('.sidebar')
    await shot(ph, 'phone-drawer')
    await shot(pad, 'tablet')

    const fresh = await browser.newContext({ viewport: { width: 1024, height: 640 } })
    const w = await fresh.newPage()
    await w.goto(origin)
    await w.waitForSelector('.welcome-foot')
    await shot(w, 'welcome')
  }

  console.log('layout self-check OK (touch resize + phone drawer)')
} finally {
  await browser.close().catch(() => {})
  wss.close()
  server.close()
  sshd.kill()
  await fs.rm(dir, { recursive: true, force: true })
}
process.exit(0)
