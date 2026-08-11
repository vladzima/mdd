// How the file tree is ordered. The vault always hands back name order; this is
// applied on top of it at render time, so switching sort never rescans the vault.

import { byName, dirOf, type TreeNode } from './vault'

export const SORTS = ['name', 'date', 'manual'] as const
export type Sort = (typeof SORTS)[number]

// folder path ('' = vault root) → the paths it contains, in the order you dragged them
export type ManualOrder = Record<string, string[]>

export function sortTree(
  nodes: TreeNode[],
  sort: Sort,
  order: ManualOrder,
  dir = '',
): TreeNode[] {
  const out = nodes.map((n) =>
    n.children ? { ...n, children: sortTree(n.children, sort, order, n.path) } : n,
  )
  if (sort === 'date') {
    // newest first; folders still lead, carrying their newest note's date
    return out.sort((a, b) => (a.kind === b.kind ? b.mtime - a.mtime : a.kind === 'dir' ? -1 : 1))
  }
  if (sort === 'manual') {
    const seq = order[dir] ?? []
    // Manual order is deliberately free-form: a folder can sit between two notes.
    // Anything the saved order has not seen — a note created elsewhere, a file
    // dropped in by Obsidian — lands after it, in name order.
    return out.sort((a, b) => {
      const ia = seq.indexOf(a.path)
      const ib = seq.indexOf(b.path)
      if (ia === -1) return ib === -1 ? byName(a, b) : 1
      return ib === -1 ? -1 : ia - ib
    })
  }
  return out.sort(byName)
}

export function childrenOf(tree: TreeNode[], dir: string): TreeNode[] {
  let nodes = tree
  for (const seg of dir.split('/').filter(Boolean)) {
    const found = nodes.find((n) => n.kind === 'dir' && n.name === seg)
    if (!found) return []
    nodes = found.children ?? []
  }
  return nodes
}

// Put `path` at the drop position within one folder's displayed order.
export function placeIn(
  shown: string[],
  path: string,
  anchor: string | null,
  place: 'before' | 'after',
): string[] {
  if (anchor === path) return shown // dropped onto itself: nothing moves
  const next = shown.filter((p) => p !== path)
  const i = anchor ? next.indexOf(anchor) : -1
  if (i === -1) return [...next, path] // dropped on the folder itself: append
  next.splice(place === 'before' ? i : i + 1, 0, path)
  return next
}

// Paths are both the keys and the values here, so a rename or a move has to be
// rewritten in both — otherwise renaming a note (which happens on its own, when a
// new note takes its title from its first heading) would send it to the end.
// `to === null` means it was deleted. Entries that no longer sit in the folder
// they are filed under are dropped, which keeps a move from leaving a stub behind.
export function remapOrder(order: ManualOrder, from: string, to: string | null): ManualOrder {
  const under = (p: string) => p === from || p.startsWith(`${from}/`)
  const rewrite = (p: string) => (under(p) ? (to === null ? null : to + p.slice(from.length)) : p)
  const out: ManualOrder = {}
  for (const [dir, paths] of Object.entries(order)) {
    const key = rewrite(dir)
    if (key === null) continue
    const kept = paths
      .map(rewrite)
      .filter((p): p is string => p !== null && dirOf(p) === key)
    if (kept.length) out[key] = kept
  }
  return out
}
