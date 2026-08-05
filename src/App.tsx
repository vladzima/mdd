import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Connect } from './Connect'
import { savedSsh } from './sshConfig'
import { supported } from './vault'
import { Editor } from './Editor'
import { Outline } from './Outline'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'

export default function App() {
  const vault = useStore((s) => s.vault)
  const activePath = useStore((s) => s.activePath)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const theme = useStore((s) => s.theme)

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    void useStore.getState().init()

    const onFocus = () => void useStore.getState().checkExternal()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        useStore.getState().toggleSidebar()
      }
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) e.preventDefault()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  useEffect(() => {
    const name = activePath?.split('/').pop()?.replace(/\.md$/, '')
    document.title = name ? `${name} — mdd` : 'mdd'
  }, [activePath])

  if (!vault) return <Welcome />

  return (
    <div className="app">
      {settingsOpen && <Settings />}
      {sidebarOpen && (
        <>
          <Sidebar />
          {/* only visible at the drawer breakpoint; tap-outside to close */}
          <div className="scrim" onClick={toggleSidebar} />
        </>
      )}
      <main className="main">
        {!sidebarOpen && (
          <button
            className="icon-btn sidebar-toggle"
            title="Show sidebar (⌘\)"
            onClick={toggleSidebar}
          >
            ⟩
          </button>
        )}
        {activePath ? (
          <Editor />
        ) : (
          <div className="empty-state">Select a note, or create one with +</div>
        )}
        <StatusBar />
      </main>
      {activePath && <Outline />}
    </div>
  )
}

function StatusBar() {
  const wordCount = useStore((s) => s.wordCount)
  const dirty = useStore((s) => s.dirty)
  const activePath = useStore((s) => s.activePath)
  if (!activePath) return null
  return (
    <footer className="status-bar">
      <span>{dirty ? 'Editing…' : 'Saved'}</span>
      <span>
        {wordCount} {wordCount === 1 ? 'word' : 'words'}
      </span>
    </footer>
  )
}

function Welcome() {
  const pendingVault = useStore((s) => s.pendingVault)
  const vaultName = useStore((s) => s.vaultName)
  const openVault = useStore((s) => s.openVault)
  const reopenVault = useStore((s) => s.reopenVault)
  const ssh = savedSsh()
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="welcome">
      <h1>mdd</h1>
      <p className="tagline">A fast markdown editor for your vault — local folder or SSH.</p>
      {showForm ? (
        <Connect onCancel={() => setShowForm(false)} />
      ) : (
        <div className="welcome-actions">
          {pendingVault && (
            <button className="btn primary" onClick={() => void reopenVault()}>
              Reopen “{vaultName}”
            </button>
          )}
          {supported && (
            <button
              className={`btn${pendingVault ? '' : ' primary'}`}
              onClick={() => void openVault()}
            >
              Open folder
            </button>
          )}
          <button className="btn" onClick={() => setShowForm(true)}>
            {ssh ? `Connect to ${ssh.host}` : 'Connect over SSH'}
          </button>
        </div>
      )}
      {!supported && !showForm && (
        <p className="unsupported">
          This browser can’t open local folders (use a Chromium browser for that). SSH works
          everywhere.
        </p>
      )}
      <p className="hint">
        Files stay on your disk or your server — nothing is stored by this app.
      </p>
    </div>
  )
}
