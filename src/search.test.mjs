// Self-check for name matching, snippet extraction and the text scan.
// Run: npm run test:search

import assert from 'node:assert'
import { LIMIT, forgetSearchCache, searchNames, searchText, snippet } from './search.ts'

const file = (path, mtime = 1) => ({
  name: path.split('/').pop().replace(/\.md$/, ''),
  path,
  kind: 'file',
  mtime,
})
const dir = (path, children) => ({ name: path.split('/').pop(), path, kind: 'dir', mtime: 1, children })

const tree = [
  dir('Recipes', [file('Recipes/Bread.md'), file('Recipes/Soup.md')]),
  file('Meeting notes.md'),
  file('Shopping.md'),
]

// --- names ---

assert.deepEqual(
  searchNames(tree, 'e').map((h) => h.path),
  ['Recipes/Bread.md', 'Meeting notes.md'],
  'names match anywhere in the name, at any depth',
)
assert.equal(searchNames(tree, 'BREAD')[0].path, 'Recipes/Bread.md', 'case-insensitive')
assert.equal(searchNames(tree, 'e')[0].at, 2, 'reports where the match starts')
assert.equal(searchNames(tree, 'e')[0].line, null, 'a name hit carries no snippet line')
assert.deepEqual(searchNames(tree, '   '), [], 'a blank query matches nothing')

// --- snippets ---

assert.deepEqual(
  snippet('# Title\n\n  the quick brown fox\n', 'quick'),
  { line: 'the quick brown fox', at: 4 },
  'the whole line, trimmed, with the match placed inside it',
)
assert.equal(snippet('nothing here', 'zzz'), null, 'no match, no snippet')
assert.deepEqual(snippet('trailing line', 'line'), { line: 'trailing line', at: 9 }, 'last line has no newline after it')

// A short line still gets wound forward when the match is late in it, or the
// sidebar's ellipsis eats the very word that was searched for.
const late = snippet('Chase the March invoice; the lighthouse commission is open.', 'lighthouse')
assert.ok(late.at <= 17, `the match starts near the front of the snippet (got ${late.at})`)
assert.equal(late.line.slice(late.at, late.at + 10), 'lighthouse', 'and `at` still points at it')
assert.ok(late.line.startsWith('…'), 'the wound-off head is marked')

// A long line is clipped around the match, or the reason it matched is off-screen.
const long = `${'a'.repeat(400)} needle ${'b'.repeat(400)}`
const clipped = snippet(long, 'needle')
assert.ok(clipped.line.length < 140, `clipped to a readable width (got ${clipped.line.length})`)
assert.equal(
  clipped.line.slice(clipped.at, clipped.at + 6),
  'needle',
  '`at` still points at the match after clipping',
)
assert.ok(clipped.line.startsWith('…') && clipped.line.endsWith('…'), 'clipping is marked at both ends')

// --- text scan ---

const texts = {
  'Recipes/Bread.md': '# Bread\n\nflour, water, salt\n',
  'Recipes/Soup.md': '# Soup\n\nstock and vegetables\n',
  'Meeting notes.md': '# Meeting\n\nagreed to buy flour\n',
  'Shopping.md': '# Shopping\n\nmilk\n',
}
let reads = 0
const vault = {
  read: (path) => {
    reads++
    return Promise.resolve({ text: texts[path], mtime: 1 })
  },
}
const live = () => true

const flour = await searchText(vault, tree, 'flour', new Set(), live)
assert.deepEqual(
  flour.map((h) => h.path),
  ['Recipes/Bread.md', 'Meeting notes.md'],
  'text search reaches into every note',
)
assert.deepEqual(flour[0], {
  path: 'Recipes/Bread.md',
  name: 'Bread',
  line: 'flour, water, salt',
  at: 0,
}, 'a text hit carries the line it matched on')

const before = reads
await searchText(vault, tree, 'salt', new Set(), live)
assert.equal(reads, before, 'unchanged notes are read once, then remembered')

texts['Shopping.md'] = '# Shopping\n\nmilk and salt\n'
const bumped = [tree[0], tree[1], file('Shopping.md', 2)]
assert.deepEqual(
  (await searchText(vault, bumped, 'salt', new Set(), live)).map((h) => h.path),
  ['Recipes/Bread.md', 'Shopping.md'],
  'a newer mtime re-reads the note',
)

assert.deepEqual(
  (await searchText(vault, tree, 'flour', new Set(['Recipes/Bread.md']), live)).map((h) => h.path),
  ['Meeting notes.md'],
  'notes already listed by name are skipped',
)
assert.deepEqual(await searchText(vault, tree, 'f', new Set(), live), [], 'one letter never reads files')
assert.deepEqual(
  await searchText(vault, tree, 'flour', new Set(), () => false),
  [],
  'a query that has moved on stops the scan',
)

// An unreadable note is not a match; it must not sink the whole search.
const flaky = {
  read: (path) =>
    path === 'Recipes/Bread.md' ? Promise.reject(new Error('gone')) : vault.read(path),
}
forgetSearchCache()
assert.deepEqual(
  (await searchText(flaky, tree, 'flour', new Set(), live)).map((h) => h.path),
  ['Meeting notes.md'],
  'one unreadable note is skipped, the rest still search',
)

// A query that matches everything must not render thousands of rows.
const many = Array.from({ length: LIMIT + 20 }, (_, i) => file(`Note ${i}.md`))
assert.equal(searchNames(many, 'note').length, LIMIT, 'name hits are capped')
forgetSearchCache()
const all = { read: () => Promise.resolve({ text: 'flour', mtime: 1 }) }
assert.equal((await searchText(all, many, 'flour', new Set(), live)).length, LIMIT, 'text hits are capped')

console.log('search ok')
