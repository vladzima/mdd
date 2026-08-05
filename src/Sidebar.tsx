import { useMemo, useState } from 'react'
import { startResize } from './resize'
import { useStore } from './store'
import type { TreeNode } from './vault'

export function Sidebar() {
  const vaultName = useStore((s) => s.vaultName)
  const tree = useStore((s) => s.tree)
  const recents = useStore((s) => s.recents)
  const createFile = useStore((s) => s.createFile)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)

  const existingPaths = useMemo(() => {
    const paths = new Set<string>()
    const collect = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'file') paths.add(n.path)
        else collect(n.children ?? [])
      }
    }
    collect(tree)
    return paths
  }, [tree])
  const recentShown = recents.filter((p) => existingPaths.has(p)).slice(0, 5)

  return (
    <aside className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar-header">
        <button
          className="vault-name"
          title="Switch vault"
          onClick={() => void useStore.getState().closeVault()}
        >
          {vaultName}
        </button>
        <button className="icon-btn" title="New note" onClick={() => void createFile()}>
          +
        </button>
        <button
          className="icon-btn"
          title="Settings"
          onClick={() => useStore.getState().setSettingsOpen(true)}
        >
          ⚙
        </button>
        <button className="icon-btn" title="Hide sidebar (⌘\)" onClick={toggleSidebar}>
          ⟨
        </button>
      </div>
      <nav className="tree">
        {recentShown.length > 0 && (
          <>
            <div className="section-label">Recent</div>
            {recentShown.map((path) => (
              <FileRow
                key={path}
                path={path}
                name={path.split('/').pop()!.replace(/\.md$/, '')}
                indent={10}
              />
            ))}
            <div className="section-label">Notes</div>
          </>
        )}
        {tree.map((node) => (
          <Node key={node.path} node={node} depth={0} />
        ))}
      </nav>
      <div
        className="resizer"
        onPointerDown={(e) => startResize(e, (x) => setSidebarWidth(Math.min(420, Math.max(180, x))))}
      />
    </aside>
  )
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const createFile = useStore((s) => s.createFile)
  const collapsed = useStore((s) => s.collapsedDirs.has(node.path))
  const toggleDir = useStore((s) => s.toggleDir)

  const indent = { paddingLeft: `${10 + depth * 14}px` }

  if (node.kind === 'dir') {
    return (
      <div>
        <div className="row dir" style={indent} onClick={() => toggleDir(node.path)}>
          <span className={`chevron${collapsed ? ' collapsed' : ''}`}>›</span>
          <span className="row-name">{node.name}</span>
          <button
            className="icon-btn row-action"
            title="New note here"
            onClick={(e) => {
              e.stopPropagation()
              void createFile(node.path)
            }}
          >
            +
          </button>
        </div>
        {!collapsed &&
          node.children!.map((child) => <Node key={child.path} node={child} depth={depth + 1} />)}
      </div>
    )
  }

  return <FileRow path={node.path} name={node.name} indent={10 + depth * 14} />
}

// Shared by the tree and the Recent list — Recent used to render a bare name,
// which left a freshly created note with no way to rename it.
function FileRow({ path, name, indent }: { path: string; name: string; indent: number }) {
  const activePath = useStore((s) => s.activePath)
  const openFile = useStore((s) => s.openFile)
  const deleteFile = useStore((s) => s.deleteFile)
  const renameFile = useStore((s) => s.renameFile)
  const [renaming, setRenaming] = useState(false)
  const style = { paddingLeft: `${indent}px` }

  if (renaming) {
    return (
      <div className="row" style={style}>
        <input
          className="rename-input"
          defaultValue={name}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.currentTarget.value = name
              e.currentTarget.blur()
            }
          }}
          onBlur={(e) => {
            const next = e.currentTarget.value.trim()
            setRenaming(false)
            if (next && next !== name) void renameFile(path, next)
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={`row file${activePath === path ? ' active' : ''}`}
      style={style}
      onClick={() => void openFile(path)}
    >
      <span className="row-name">{name}</span>
      <button
        className="icon-btn row-action"
        title="Rename"
        onClick={(e) => {
          e.stopPropagation()
          setRenaming(true)
        }}
      >
        ✎
      </button>
      <button
        className="icon-btn row-action"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`Delete "${name}"?`)) void deleteFile(path)
        }}
      >
        ×
      </button>
    </div>
  )
}
