import { useEffect, useState } from 'react'
import { useStore } from './store'
import { savedRemote } from './remote'
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
      {sidebarOpen && <Sidebar />}
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
  const connectRemote = useStore((s) => s.connectRemote)
  const remote = savedRemote()
  const [showForm, setShowForm] = useState(false)
  const [url, setUrl] = useState(remote?.url ?? '')
  const [token, setToken] = useState(remote?.token ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function connect(u: string, t: string) {
    setBusy(true)
    setError('')
    try {
      await connectRemote(u, t)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome">
      <h1>mdd</h1>
      <p className="tagline">A fast, local markdown editor for your vault.</p>
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
        {remote && !showForm && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => void connect(remote.url, remote.token)}
          >
            {busy ? 'Connecting…' : `Reconnect ${new URL(remote.url).hostname}`}
          </button>
        )}
        {!showForm && (
          <button className="btn" onClick={() => setShowForm(true)}>
            Connect to server
          </button>
        )}
      </div>
      {showForm && (
        <form
          className="connect-form"
          onSubmit={(e) => {
            e.preventDefault()
            void connect(url.replace(/\/+$/, ''), token)
          }}
        >
          <input
            className="text-input"
            placeholder="https://vault.edit.computer"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.currentTarget.value)}
          />
          <input
            className="text-input"
            type="password"
            placeholder="Token"
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
          />
          <button className="btn primary" disabled={busy || !url || !token}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      )}
      {error && <p className="connect-error">{error}</p>}
      {!supported && (
        <p className="unsupported">
          This browser can’t open local folders (use a Chromium browser for that). Remote vaults
          work everywhere.
        </p>
      )}
      <p className="hint">Files stay on disk — nothing is uploaded.</p>
    </div>
  )
}
