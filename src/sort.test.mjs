#!/usr/bin/env node
// Ordering rules, checked directly. The browser test drives these through the UI;
// this covers the bookkeeping that only shows up on edge cases — mainly that a
// manual order survives the renames the app does on its own.

import assert from 'node:assert'
import { childrenOf, placeIn, remapOrder, sortTree } from './sort.ts'

const file = (path, mtime) => ({ name: path.split('/').pop().replace(/\.md$/, ''), path, kind: 'file', mtime })
const dir = (path, children, mtime = 0) => ({ name: path.split('/').pop(), path, kind: 'dir', mtime, children })

const tree = [
  file('Banana.md', 300),
  dir('work', [file('work/Zed.md', 100), file('work/Alpha.md', 500)], 500),
  file('Apple.md', 200),
]
const paths = (nodes) => nodes.map((n) => n.path)

// name: folders first, then alphabetical — the order the vault hands back
assert.deepEqual(paths(sortTree(tree, 'name', {})), ['work', 'Apple.md', 'Banana.md'])
assert.deepEqual(paths(sortTree(tree, 'name', {})[0].children), ['work/Alpha.md', 'work/Zed.md'])

// date: newest first, applied at every depth
assert.deepEqual(paths(sortTree(tree, 'date', {})), ['work', 'Banana.md', 'Apple.md'])
assert.deepEqual(paths(sortTree(tree, 'date', {})[0].children), ['work/Alpha.md', 'work/Zed.md'])

// manual: exactly what was saved, and a folder may sit between two notes
const order = { '': ['Apple.md', 'work', 'Banana.md'] }
assert.deepEqual(paths(sortTree(tree, 'manual', order)), ['Apple.md', 'work', 'Banana.md'])

// anything the saved order has not seen lands after it, in name order
assert.deepEqual(
  paths(sortTree(tree, 'manual', { '': ['Banana.md'] })),
  ['Banana.md', 'work', 'Apple.md'],
  'unseen entries fall to the end',
)

// dropping onto a row inserts either side of it; dropping onto a folder appends
assert.deepEqual(placeIn(['a', 'b', 'c'], 'c', 'a', 'before'), ['c', 'a', 'b'])
assert.deepEqual(placeIn(['a', 'b', 'c'], 'a', 'b', 'after'), ['b', 'a', 'c'])
assert.deepEqual(placeIn(['a', 'b'], 'a', null, 'after'), ['b', 'a'])

// A note renames itself the moment it grows a heading. If that dropped it out of
// the manual order it would jump to the bottom of the list as you typed.
assert.deepEqual(
  remapOrder({ '': ['Untitled.md', 'Apple.md'] }, 'Untitled.md', 'Kitchen notes.md'),
  { '': ['Kitchen notes.md', 'Apple.md'] },
  'a rename keeps its place',
)

// renaming a folder rewrites its own key and every path filed under it
assert.deepEqual(
  remapOrder({ '': ['work'], work: ['work/Zed.md', 'work/Alpha.md'] }, 'work', 'jobs'),
  { '': ['jobs'], jobs: ['jobs/Zed.md', 'jobs/Alpha.md'] },
  'a folder rename takes its children with it',
)

// deleting drops the entry, and a deleted folder takes its whole section
assert.deepEqual(remapOrder({ '': ['a.md', 'b.md'] }, 'a.md', null), { '': ['b.md'] })
assert.deepEqual(remapOrder({ '': ['work'], work: ['work/Zed.md'] }, 'work', null), {})

// A move rewrites the path, which would otherwise leave a stub in the old folder
// pointing at a note that now lives somewhere else.
assert.deepEqual(
  remapOrder({ '': ['work', 'Apple.md'], work: ['work/Zed.md'] }, 'work/Zed.md', 'Zed.md'),
  { '': ['work', 'Apple.md'] },
  'the old folder does not keep a stub',
)

assert.deepEqual(paths(childrenOf(tree, 'work')), ['work/Zed.md', 'work/Alpha.md'])
assert.deepEqual(paths(childrenOf(tree, '')), paths(tree))
assert.deepEqual(childrenOf(tree, 'nope'), [])

console.log('sort self-check OK')
