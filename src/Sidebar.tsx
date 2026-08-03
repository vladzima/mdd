import { useMemo, useState } from 'react'
import { useStore } from './store'
import type { TreeNode } from './vault'

export function Sidebar() {
  const vaultName = useStore((s) => s.vaultName)
  const tree = useStore((s) => s.tree)
  const recents = useStore((s) => s.recents)
  const activePath = useStore((s) => s.activePath)
  const openFile = useStore((s) => s.openFile)
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

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const move = (ev: MouseEvent) =>
      setSidebarWidth(Math.min(420, Math.max(180, ev.clientX)))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <aside className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar-header">
        <span className="vault-name" title={vaultName}>
          {vaultName}
        </span>
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
              <div
                key={path}
                className={`row file${activePath === path ? ' active' : ''}`}
                style={{ paddingLeft: '10px' }}
                onClick={() => void openFile(path)}
              >
                <span className="row-name">{path.split('/').pop()!.replace(/\.md$/, '')}</span>
              </div>
            ))}
            <div className="section-label">Notes</div>
          </>
        )}
        {tree.map((node) => (
          <Node key={node.path} node={node} depth={0} />
        ))}
      </nav>
      <div className="resizer" onMouseDown={startResize} />
    </aside>
  )
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const activePath = useStore((s) => s.activePath)
  const openFile = useStore((s) => s.openFile)
  const createFile = useStore((s) => s.createFile)
  const deleteFile = useStore((s) => s.deleteFile)
  const renameFile = useStore((s) => s.renameFile)
  const collapsed = useStore((s) => s.collapsedDirs.has(node.path))
  const toggleDir = useStore((s) => s.toggleDir)
  const [renaming, setRenaming] = useState(false)

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

  if (renaming) {
    return (
      <div className="row" style={indent}>
        <input
          className="rename-input"
          defaultValue={node.name}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.currentTarget.value = node.name
              e.currentTarget.blur()
            }
          }}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim()
            setRenaming(false)
            if (name && name !== node.name) void renameFile(node.path, name)
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={`row file${activePath === node.path ? ' active' : ''}`}
      style={indent}
      onClick={() => void openFile(node.path)}
    >
      <span className="row-name">{node.name}</span>
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
          if (confirm(`Delete "${node.name}"?`)) void deleteFile(node.path)
        }}
      >
        ×
      </button>
    </div>
  )
}
