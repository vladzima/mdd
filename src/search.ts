// Search across the vault. Names come out of the tree that is already in memory,
// so they answer every keystroke on the spot; text needs the files themselves,
// which are read once and kept until they change on disk.

import type { TreeNode, Vault } from './vault'

export interface Hit {
  path: string
  name: string
  line: string | null // the matching line of text; null when the name is what matched
  at: number // where the match starts — within `line` if there is one, else within `name`
}

// One letter matches half the vault; reading every note to prove it is not worth
// the round trips. The name list still answers a single letter instantly.
export const MIN_TEXT = 2
export const LIMIT = 50
const BATCH = 8 // reads in flight — an SSH vault costs one round trip per note
const SNIPPET = 120 // characters of the matching line to keep
const LEAD = 16 // ...of which this many come before the match itself

const cache = new Map<string, { mtime: number; text: string }>()

// Another vault can hold the same path with the same mtime, and it would be
// served this vault's text. Cheap insurance, called when the vault is swapped.
export function forgetSearchCache(): void {
  cache.clear()
}

function notesIn(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    if (n.kind === 'file') out.push(n)
    else notesIn(n.children ?? [], out)
  }
  return out
}

export function searchNames(tree: TreeNode[], query: string): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  for (const n of notesIn(tree)) {
    const at = n.name.toLowerCase().indexOf(q)
    if (at !== -1) hits.push({ path: n.path, name: n.name, line: null, at })
    if (hits.length === LIMIT) break
  }
  return hits
}

export async function searchText(
  vault: Vault,
  tree: TreeNode[],
  query: string,
  skip: Set<string>, // already matched by name; no point listing them twice
  live: () => boolean, // false once the query has moved on — stops the scan mid-vault
): Promise<Hit[]> {
  const q = query.trim().toLowerCase()
  if (q.length < MIN_TEXT) return []
  const notes = notesIn(tree).filter((n) => !skip.has(n.path))
  const hits: Hit[] = []
  for (let i = 0; i < notes.length && hits.length < LIMIT && live(); i += BATCH) {
    const batch = notes.slice(i, i + BATCH)
    const texts = await Promise.all(batch.map((n) => textOf(vault, n)))
    for (const [j, n] of batch.entries()) {
      const found = snippet(texts[j], q)
      if (found && hits.length < LIMIT) hits.push({ path: n.path, name: n.name, ...found })
    }
  }
  return hits
}

async function textOf(vault: Vault, note: TreeNode): Promise<string> {
  const known = cache.get(note.path)
  if (known?.mtime === note.mtime) return known.text
  // A note that will not read — deleted under us, permission withdrawn — is simply
  // not a match; one unreadable file must not sink the whole search.
  const text = await vault.read(note.path).then(
    (r) => r.text,
    () => '',
  )
  cache.set(note.path, { mtime: note.mtime, text })
  return text
}

// The line the match sits on, wound forward so the match is near the front of it.
// A sidebar is a couple of hundred pixels wide and ellipsis-clips the rest, so a
// snippet that starts at the start of the paragraph shows everything except the
// word that was searched for.
export function snippet(text: string, q: string): { line: string; at: number } | null {
  const i = text.toLowerCase().indexOf(q)
  if (i === -1) return null
  const from = text.lastIndexOf('\n', i) + 1
  const to = text.indexOf('\n', i)
  const raw = text.slice(from, to === -1 ? text.length : to)
  const lead = raw.length - raw.trimStart().length
  const line = raw.trim()
  const at = i - from - lead
  const start = Math.max(0, at - LEAD)
  if (start === 0 && line.length <= SNIPPET) return { line, at }
  const head = start > 0 ? '…' : ''
  const tail = start + SNIPPET < line.length ? '…' : ''
  return { line: head + line.slice(start, start + SNIPPET) + tail, at: at - start + head.length }
}
