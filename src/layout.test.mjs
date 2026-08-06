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

const centre = (page, sel) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })

// A mouse starts dragging as soon as it moves past the slop; the first short hop
// is what crosses it.
async function mouseDrag(page, fromSel, toSel, edge = 0) {
  const a = await centre(page, fromSel)
  const b = await centre(page, toSel)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + 12, a.y, { steps: 2 })
  await page.mouse.move(b.x, b.y + edge, { steps: 8 })
  await page.mouse.up()
}

// Chromium turns emulated touch into the pointer events the app listens for;
// playwright's touchscreen only taps, so drags go through raw CDP. A finger has
// to press and hold before it can move a note, because a finger that moves
// straight away meant to scroll the tree — pass `hold` to outlast that.
async function touchDrag(page, from, to, { hold = 0 } = {}) {
  const cdp = await page.context().newCDPSession(page)
  const at = (x, y) => [{ x, y, radiusX: 12, radiusY: 12, force: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x, from.y) })
  if (hold) await new Promise((r) => setTimeout(r, hold))
  for (let i = 1; i <= 5; i++) {
    const t = i / 5
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: at(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t),
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

const dragResizer = (page, fromX, fromY, toX, toY) =>
  touchDrag(page, { x: fromX, y: fromY }, { x: toX, y: toY })

// what the tree shows, top to bottom (Recent has no data-path, so it is excluded)
const treeOrder = (page) => page.$$eval('.tree [data-path]', (els) => els.map((e) => e.dataset.path))

const exists = (...parts) =>
  fs.access(path.join(...parts)).then(
    () => true,
    () => false,
  )

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

// Every ask, rename and error has to be drawn by the app. A browser dialog says
// "<hostname> says", blocks the page and cannot be themed, so any that escapes is
// a bug — record them all and fail at the end rather than hanging on one.
const nativeDialogs = []
const watchDialogs = (page, where) =>
  page.on('dialog', (d) => {
    nativeDialogs.push(`${where}: ${d.type()} ${JSON.stringify(d.message())}`)
    void d.dismiss()
  })

// Row actions are revealed by hover on a desktop, and playwright checks
// visibility before it moves the mouse, so the hover has to be its own step.
async function clickRowAction(page, path, title) {
  await page.hover(`[data-path="${path}"]`)
  await page.click(`[data-path="${path}"] [title="${title}"]`)
}

// Poll from here rather than in the page: the assertions are about the order of
// several rows, which is easier to read (and to report on failure) in node.
async function waitFor(read, ok, label) {
  let last
  for (let i = 0; i < 60; i++) {
    last = await read()
    if (ok(last)) return last
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`${label} — last saw ${JSON.stringify(last)}`)
}

const dialogText = (page) => page.textContent('.dialog-message')
const answerDialog = (page) => page.click('.dialog .btn.primary')

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

  // A bare "edit.computer" says nothing in a search result or a shared link.
  const descriptive = (what, s) => {
    assert.ok(s, `${what} present`)
    assert.ok(s.includes('edit.computer'), `${what} carries the name (got "${s}")`)
    assert.ok(s.length > 30, `${what} says what the app is (got "${s}")`)
  }
  descriptive('<title>', /<title>([^<]+)<\/title>/.exec(html)?.[1])
  descriptive('og:title', /<meta\s+property="og:title"\s+content="([^"]+)"/s.exec(html)?.[1])

  // ...and the app must not overwrite it with the short form on the landing page
  const intro = await browser.newContext({ viewport: { width: 1024, height: 640 } })
  const w = await intro.newPage()
  await w.goto(origin)
  await w.waitForSelector('.welcome-foot')
  descriptive('runtime landing title', await w.title())

  // === iPad: landscape, touch, desktop layout with both resizers ===
  const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true })
  const pad = await tablet.newPage()
  watchDialogs(pad, 'tablet')
  await connect(pad)
  await pad.click('.row.file:has-text("Root")') // heading-bearing note, so the outline renders
  await pad.waitForSelector('.outline')

  assert.equal(await width('.sidebar')(pad), 240, 'sidebar starts at its default width')

  // the actual bug: a finger on the grab strip did nothing, because it only
  // ever listened for mousemove
  await dragResizer(pad, 240, 400, 350, 400)
  const dragged = await width('.sidebar')(pad)
  assert.ok(Math.abs(dragged - 350) <= 4, `touch drag resized the sidebar (got ${dragged})`)
  assert.equal(await pad.evaluate(() => localStorage.getItem('mdd:sidebar-width')), '350', 'width persisted')

  // clamps hold on touch too
  await dragResizer(pad, 350, 400, 900, 400)
  assert.equal(await width('.sidebar')(pad), 420, 'sidebar clamps at 420')

  // right-hand outline resizer, dragged leftwards to widen
  const outlineBefore = await width('.outline')(pad)
  await dragResizer(pad, 1024 - outlineBefore, 400, 1024 - outlineBefore - 90, 400)
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
    await pad.$eval('.row-action', (el) => getComputedStyle(el).opacity),
    '1',
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
  watchDialogs(ph, 'phone')
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
  await ph.tap('.row.file:has-text("Root") [title="Rename"]')
  await ph.waitForSelector('.dialog')
  assert.equal(await dialogText(ph), 'Rename note', 'the app asks, in its own dialog')
  const nameField = await ph.waitForSelector('.dialog .text-input')
  assert.equal(await nameField.inputValue(), 'Root', 'prefilled with the current name')
  assert.equal(await ph.$$eval('.rename-input', (e) => e.length), 0, 'no inline field on a phone')
  await nameField.fill('Renamed on phone')
  await answerDialog(ph)
  // the drawer must survive the rename — it closes on opening a note, not on
  // any change of the active path
  await ph.waitForSelector('.row.file:has-text("Renamed on phone")')
  await fs.access(path.join(vault, 'Renamed on phone.md'))

  // === desktop: hover is the only thing that hides row actions, so this is
  // where a note you just made can end up with no visible way to rename it ===
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const dk = await desk.newPage()
  watchDialogs(dk, 'desktop')
  await connect(dk)
  await dk.click('.sidebar-header .icon-btn[title="New note"]')
  await dk.waitForSelector('.row.file.active:has-text("Untitled")')

  const active = await dk.$$('.row.file.active')
  assert.equal(active.length, 2, 'the new note is listed under Recent and in the tree')
  // Faded rather than `visibility: hidden`, so they stay focusable and a keyboard
  // user can reach them; opacity is what says whether they are on show. Polled,
  // because the fade takes 120ms and a bare read catches it mid-transition.
  const shown = (handle) => () => handle.evaluate((el) => getComputedStyle(el).opacity)
  for (const row of active) {
    const rename = await row.$('[title="Rename"]')
    assert.ok(rename, 'every listing of a note offers rename')
    await waitFor(shown(rename), (o) => o === '1', 'the open note shows its actions without a hover')
  }
  const idle = await dk.$('.row.file:not(.active)')
  const idleRename = await idle.$('[title="Rename"]')
  await waitFor(shown(idleRename), (o) => o === '0', 'notes you are not editing stay quiet until hovered')
  // ...but they come out for the keyboard, or they would be unreachable without a mouse
  await idleRename.focus()
  await waitFor(shown(idleRename), (o) => o === '1', 'focus reveals them too')
  await dk.evaluate(() => document.activeElement?.blur())

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

  // === icons ===
  // The header used to be text glyphs. If a name is wrong the import resolves to
  // nothing and the button renders empty, which looks like a styling bug.
  // prefix match: the hide button's title ends in a backslash, which a CSS
  // attribute selector would read as an escape
  for (const title of ['New note', 'New folder', 'Sort', 'Settings', 'Hide sidebar']) {
    const svg = await dk.$(`.sidebar-header .icon-btn[title^="${title}"] svg`)
    assert.ok(svg, `${title} renders an icon`)
    assert.ok(await svg.evaluate((el) => el.innerHTML.length > 20), `${title} icon has artwork`)
  }

  // === folders: create, rename, drag a note in and out, delete when empty ===
  await dk.click('.sidebar-header .icon-btn[title="New folder"]')
  const folderField = await dk.waitForSelector('.rename-input')
  await folderField.fill('Archive')
  await folderField.press('Enter')
  await dk.waitForSelector('[data-path="Archive"]')
  assert.ok(await exists(vault, 'Archive'), 'folder created on disk')

  await mouseDrag(dk, '[data-path="Kitchen notes.md"]', '[data-path="Archive"]')
  await dk.waitForSelector('[data-path="Archive/Kitchen notes.md"]')
  assert.ok(await exists(vault, 'Archive', 'Kitchen notes.md'), 'note dragged into the folder')
  assert.ok(!(await exists(vault, 'Kitchen notes.md')), 'and left the root')

  // renaming a folder has to take everything inside it along
  await clickRowAction(dk, 'Archive', 'Rename')
  const again = await dk.waitForSelector('.rename-input')
  await again.fill('Archived')
  await again.press('Enter')
  await dk.waitForSelector('[data-path="Archived/Kitchen notes.md"]')
  assert.ok(await exists(vault, 'Archived', 'Kitchen notes.md'), 'the note moved with its folder')

  // deleting a folder with anything in it must say so rather than take the notes down
  await clickRowAction(dk, 'Archived', 'Delete folder')
  assert.match(await dialogText(dk), /Delete folder/, 'asked before deleting')
  await answerDialog(dk)
  await dk.waitForFunction(() =>
    document.querySelector('.dialog-message')?.textContent?.includes('empty'),
  )
  assert.match(await dialogText(dk), /isn’t empty/, 'the refusal says why')
  await answerDialog(dk)
  await dk.waitForSelector('.dialog', { state: 'detached' })
  assert.ok(await exists(vault, 'Archived', 'Kitchen notes.md'), 'the note inside survived')

  // drag it back out: the empty space under the tree is the vault root
  const treeBox = await dk.$eval('.tree', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.bottom - 12 }
  })
  const note = await centre(dk, '[data-path="Archived/Kitchen notes.md"]')
  await dk.mouse.move(note.x, note.y)
  await dk.mouse.down()
  await dk.mouse.move(note.x + 12, note.y, { steps: 2 })
  await dk.mouse.move(treeBox.x, treeBox.y, { steps: 8 })
  await dk.mouse.up()
  await dk.waitForSelector('[data-path="Kitchen notes.md"]')
  assert.ok(!(await exists(vault, 'Archived', 'Kitchen notes.md')), 'dragged back to the root')

  await clickRowAction(dk, 'Archived', 'Delete folder')
  await answerDialog(dk)
  await dk.waitForSelector('[data-path="Archived"]', { state: 'detached' })
  await dk.waitForSelector('.dialog', { state: 'detached' })
  assert.ok(!(await exists(vault, 'Archived')), 'an empty folder just goes')

  // === sorting ===
  // Age one note past the others so date order is decidable rather than a race.
  const old = new Date(Date.now() - 5 * 24 * 3600 * 1000)
  await fs.utimes(path.join(vault, 'Kitchen notes.md'), old, old)
  await dk.evaluate(() => window.dispatchEvent(new Event('focus'))) // picks up disk changes
  await dk.waitForTimeout(400)

  const rootFiles = (order) => order.filter((p) => !p.includes('/') && p.endsWith('.md'))
  const byNameOrder = rootFiles(await treeOrder(dk))
  assert.deepEqual([...byNameOrder].sort(), byNameOrder, 'name sort is alphabetical')

  await dk.click('.sort-menu .icon-btn')
  await dk.click('.menu-item:has-text("Date edited")')
  const byDate = rootFiles(await treeOrder(dk))
  assert.equal(byDate.at(-1), 'Kitchen notes.md', `oldest note sorts last (got ${byDate.join(', ')})`)
  assert.equal(
    await dk.evaluate(() => localStorage.getItem('mdd:sort')),
    'date',
    'sort choice persisted',
  )

  // manual: drag one note above another and the order is yours to keep
  await dk.click('.sort-menu .icon-btn')
  await dk.click('.menu-item:has-text("Manual")')
  const start = rootFiles(await treeOrder(dk))
  const [first, second] = [start[0], start[1]]
  // -8px lands in the upper half of the row, which means "insert before it"
  await mouseDrag(dk, `[data-path="${second}"]`, `[data-path="${first}"]`, -8)
  await waitFor(
    async () => rootFiles(await treeOrder(dk)).slice(0, 2),
    (got) => got[0] === second && got[1] === first,
    'the dragged note took the position above',
  )
  const savedOrder = await dk.evaluate(() => JSON.parse(localStorage.getItem('mdd:manual-order')))
  assert.ok(savedOrder[''].indexOf(second) < savedOrder[''].indexOf(first), 'order persisted')

  // Recent is a shortcut list, not a place — it must not be draggable
  assert.equal(
    await dk.$$eval('[data-nodrop] [data-path]', (els) => els.length),
    0,
    'recent rows are not drop targets',
  )

  // === touch: press and hold to drag, but a straight swipe still scrolls ===
  // this context has been open since the resizer checks; the desktop one has
  // moved files around since, so re-walk the vault before pointing at rows
  await pad.evaluate(() => window.dispatchEvent(new Event('focus')))
  await pad.click('.sort-menu .icon-btn')
  await pad.click('.menu-item:has-text("Name")')
  await pad.waitForSelector('[data-path="folder"]')
  await pad.waitForSelector('[data-path="Kitchen notes.md"]')
  const swipeFrom = await centre(pad, '[data-path="Kitchen notes.md"]')
  await touchDrag(pad, swipeFrom, { x: swipeFrom.x, y: swipeFrom.y + 120 })
  await pad.waitForTimeout(300)
  assert.ok(
    await exists(vault, 'Kitchen notes.md'),
    'a swipe without a hold scrolls, it does not move the note',
  )

  const holdFrom = await centre(pad, '[data-path="Kitchen notes.md"]')
  const onto = await centre(pad, '[data-path="folder"]')
  await touchDrag(pad, holdFrom, onto, { hold: 550 })
  await pad.waitForSelector('[data-path="folder/Kitchen notes.md"]', { timeout: 5000 })
  assert.ok(await exists(vault, 'folder', 'Kitchen notes.md'), 'press-and-hold drag moved the note')

  // === keyboard and motion ===
  // The file list is a pile of divs, so without this it is mouse-only. One tab
  // stop for the tree, arrows within it.
  const focused = () =>
    dk.evaluate(() => document.activeElement?.getAttribute('data-path') ?? document.activeElement?.className)
  await dk.evaluate(() => document.querySelector('.tree').focus())
  const landed = await focused()
  assert.ok(landed?.endsWith('.md'), `tabbing into the tree lands on a note (got ${landed})`)

  const order = await treeOrder(dk)
  await dk.keyboard.press('Home')
  assert.equal(await focused(), order[0], 'Home goes to the top')
  await dk.keyboard.press('ArrowDown')
  assert.equal(await focused(), order[1], 'ArrowDown moves down the tree')
  await dk.keyboard.press('ArrowUp')
  assert.equal(await focused(), order[0], 'and ArrowUp comes back')
  await dk.keyboard.press('End')
  assert.equal(await focused(), order.at(-1), 'End goes to the bottom')

  // a folder opens and closes with the arrows rather than needing a click
  const folderRow = (await treeOrder(dk)).find((p) => !p.includes('.'))
  if (folderRow) {
    await dk.evaluate((p) => document.querySelector(`[data-path="${p}"]`).focus(), folderRow)
    const expanded = () => dk.getAttribute(`[data-path="${folderRow}"]`, 'aria-expanded')
    const before = await expanded()
    await dk.keyboard.press(before === 'true' ? 'ArrowLeft' : 'ArrowRight')
    assert.notEqual(await expanded(), before, 'arrow keys open and shut a folder')
    await dk.keyboard.press(before === 'true' ? 'ArrowRight' : 'ArrowLeft')
  }

  // Answering a dialog has to put the keyboard back where it came from, or every
  // confirm dumps you at the top of the page.
  const victim = (await treeOrder(dk)).find((p) => p.endsWith('.md'))
  await dk.hover(`[data-path="${victim}"]`)
  await dk.focus(`[data-path="${victim}"] [title="Delete"]`)
  await dk.keyboard.press('Enter')
  await dk.waitForSelector('.dialog')
  assert.ok(
    await dk.evaluate(() => document.querySelector('.dialog')?.contains(document.activeElement)),
    'focus moves into the dialog',
  )
  await dk.keyboard.press('Escape')
  await dk.waitForSelector('.dialog', { state: 'detached' })
  assert.equal(await dk.evaluate(() => document.activeElement?.title), 'Delete', 'and back to the trigger')
  assert.ok(await exists(vault, victim), 'Escape cancelled rather than deleted')

  // the sort button says whether its menu is open, and the arrows walk it
  assert.equal(await dk.getAttribute('.sort-menu .icon-btn', 'aria-expanded'), 'false')
  await dk.click('.sort-menu .icon-btn')
  assert.equal(await dk.getAttribute('.sort-menu .icon-btn', 'aria-expanded'), 'true')
  await dk.keyboard.press('ArrowDown')
  assert.ok(
    await dk.evaluate(() => document.activeElement?.classList.contains('menu-item')),
    'ArrowDown steps into the menu',
  )
  await dk.keyboard.press('Escape')
  await dk.waitForSelector('.menu', { state: 'detached' })

  // === search ===
  // A vault you cannot search is one you can only browse. Names come out of the
  // tree already in memory, bodies have to be read off the server, so the two
  // arrive separately and both have to land.
  await dk.click('.sidebar-header .icon-btn[title="New note"]')
  await dk.waitForSelector('.row.file.active:has-text("Untitled")')
  await dk.click('.cm-content') // the editor takes focus a beat after the row appears
  await dk.keyboard.type('# Zeppelin log\nthe hydrogen inventory needs checking')
  await dk.waitForSelector('[data-path="Zeppelin log.md"]')

  const results = () => dk.$$eval('.row.hit', (els) => els.map((e) => e.dataset.path))
  await dk.fill('.search-input', 'zepp')
  await waitFor(results, (r) => r.join() === 'Zeppelin log.md', 'a name match is listed')
  assert.equal(
    await dk.textContent('.row.hit mark'),
    'Zepp',
    'the matched run is marked, in the case the note actually spells it',
  )
  assert.equal(await dk.$$eval('.row.dir', (e) => e.length), 0, 'the tree gives way to the results')

  // a word in no note's name — this one costs a read per note
  await dk.fill('.search-input', 'hydrogen')
  await waitFor(results, (r) => r.join() === 'Zeppelin log.md', 'a body match is listed')
  assert.equal(
    await dk.textContent('.row.hit .hit-line'),
    'the hydrogen inventory needs checking',
    'and it shows the line it matched on',
  )

  // the field is where a search starts, so the results have to be reachable from it
  await dk.focus('.search-input')
  await dk.keyboard.press('ArrowDown')
  assert.equal(await focused(), 'Zeppelin log.md', 'ArrowDown steps from the field into the results')

  await dk.fill('.search-input', 'no-such-note-anywhere')
  await waitFor(
    () => dk.textContent('.section-label'),
    (t) => t === 'No matches',
    'an empty result says so rather than looking like an empty vault',
  )

  await dk.focus('.search-input')
  await dk.keyboard.press('Escape')
  await dk.waitForSelector('.row.dir')
  assert.equal(await dk.inputValue('.search-input'), '', 'Escape clears the field and the tree returns')

  // ⌘K is how anyone actually reaches the field
  await dk.evaluate(() => document.querySelector('.cm-content')?.focus())
  await dk.keyboard.press('Control+k')
  await waitFor(
    () => dk.evaluate(() => document.activeElement?.className),
    (c) => String(c).includes('search-input'),
    '⌘K puts the keyboard in the search field',
  )
  await dk.keyboard.press('Escape')

  // The drawer slides; the desktop column must not. It is toggled with ⌘\ dozens
  // of times a day, and animating a keyboard action makes it feel broken.
  if (!(await ph.$('.sidebar'))) {
    await ph.tap('.sidebar-toggle') // the rename check may have left it open
    await ph.waitForSelector('.sidebar')
  }
  assert.match(
    await ph.$eval('.sidebar', (el) => getComputedStyle(el).transitionProperty),
    /transform/,
    'the phone drawer slides in',
  )
  // duration, not property: with nothing declared the property computes to the
  // initial `all`, and only the 0s duration says it never actually moves
  assert.equal(
    await dk.$eval('.sidebar', (el) => getComputedStyle(el).transitionDuration),
    '0s',
    'the desktop sidebar has no transition — it is a keyboard toggle',
  )

  // === local folder vault ===
  // Everything above went over SSH, where a move is one SFTP rename. The local
  // backend has to build a move out of File System Access calls — recursing into
  // a folder, moving each file, then removing what it emptied — and that is the
  // code that can lose a note if it is wrong. The origin-private filesystem hands
  // out real FileSystemDirectoryHandles, so pointing the picker at one exercises
  // that path end to end without a picker dialog nobody can click.
  const local = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await local.addInitScript(() => {
    window.showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('vault', { create: true })
  })
  const lo = await local.newPage()
  watchDialogs(lo, 'local')

  const onDisk = () =>
    lo.evaluate(async () => {
      const walk = async (dir, prefix) => {
        const out = []
        for await (const [name, handle] of dir.entries()) {
          out.push(prefix + name + (handle.kind === 'directory' ? '/' : ''))
          if (handle.kind === 'directory') out.push(...(await walk(handle, `${prefix}${name}/`)))
        }
        return out
      }
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('vault', {
        create: true,
      })
      return (await walk(root, '')).sort()
    })

  await lo.goto(origin)
  await lo.click('button:has-text("Open folder")')
  await lo.waitForSelector('.sidebar')

  await lo.click('.sidebar-header .icon-btn[title="New note"]')
  await lo.waitForSelector('.row.file.active:has-text("Untitled")')
  await lo.keyboard.type('# Local note\nbody')
  await lo.waitForSelector('[data-path="Local note.md"]')

  await lo.click('.sidebar-header .icon-btn[title="New folder"]')
  const localField = await lo.waitForSelector('.rename-input')
  await localField.fill('Kept')
  await localField.press('Enter')
  await lo.waitForSelector('[data-path="Kept"]')
  assert.deepEqual(await onDisk(), ['Kept/', 'Local note.md'], 'folder made in the local vault')

  await mouseDrag(lo, '[data-path="Local note.md"]', '[data-path="Kept"]')
  await lo.waitForSelector('[data-path="Kept/Local note.md"]')
  assert.deepEqual(
    await onDisk(),
    ['Kept/', 'Kept/Local note.md'],
    'the note moved into the folder and left nothing behind',
  )

  // the recursive case: renaming the folder has to carry the note with it
  await clickRowAction(lo, 'Kept', 'Rename')
  const localAgain = await lo.waitForSelector('.rename-input')
  await localAgain.fill('Moved')
  await localAgain.press('Enter')
  await lo.waitForSelector('[data-path="Moved/Local note.md"]')
  assert.deepEqual(await onDisk(), ['Moved/', 'Moved/Local note.md'], 'folder rename moved its note')
  // the heading's `#` is hidden by the live preview once the cursor leaves the line
  assert.equal(
    await lo.textContent('.cm-content'),
    'Local notebody',
    'and the open note still reads its contents from the new path',
  )

  const localTree = await lo.$eval('.tree', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.bottom - 12 }
  })
  const localNote = await centre(lo, '[data-path="Moved/Local note.md"]')
  await lo.mouse.move(localNote.x, localNote.y)
  await lo.mouse.down()
  await lo.mouse.move(localNote.x + 12, localNote.y, { steps: 2 })
  await lo.mouse.move(localTree.x, localTree.y, { steps: 8 })
  await lo.mouse.up()
  await lo.waitForSelector('[data-path="Local note.md"]')

  await clickRowAction(lo, 'Moved', 'Delete folder')
  await answerDialog(lo)
  await lo.waitForSelector('[data-path="Moved"]', { state: 'detached' })
  assert.deepEqual(await onDisk(), ['Local note.md'], 'the emptied folder was removed')

  // Reduced motion means fewer and gentler, not none: the fade still explains
  // that something arrived, only the movement goes.
  await lo.emulateMedia({ reducedMotion: 'reduce' })
  await clickRowAction(lo, 'Local note.md', 'Delete')
  await lo.waitForSelector('.dialog')
  const motion = await lo.$eval('.dialog', (el) => {
    const s = getComputedStyle(el)
    return { transform: s.transform, props: s.transitionProperty }
  })
  assert.equal(motion.transform, 'none', 'reduced motion drops the scale')
  assert.match(motion.props, /opacity/, 'and keeps the fade')
  await lo.click('.dialog .btn:has-text("Cancel")')
  await lo.emulateMedia({ reducedMotion: null })

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

    await shot(w, 'welcome')
  }

  assert.deepEqual(nativeDialogs, [], 'nothing fell back to a browser dialog')

  console.log('layout self-check OK (touch resize, phone drawer, folders, drag, sort, search)')
} finally {
  await browser.close().catch(() => {})
  wss.close()
  server.close()
  sshd.kill()
  await fs.rm(dir, { recursive: true, force: true })
}
process.exit(0)
