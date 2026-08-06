import { useEffect, useState } from 'react'
import SidebarLeft from 'reicon-react/icons/SidebarLeft'
import { useStore } from './store'
import { Connect } from './Connect'
import { DialogHost } from './Dialog'
import { useNarrow } from './layout'
import { useLingering } from './motion'
import { savedSsh } from './sshConfig'
import { supported } from './vault'
import { Editor } from './Editor'
import { Outline } from './Outline'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'

// Keep in step with <title> and og:title in index.html.
const SITE_TITLE = 'edit.computer — markdown editor for your own files, local or SSH'

export default function App() {
  const vault = useStore((s) => s.vault)
  const activePath = useStore((s) => s.activePath)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const theme = useStore((s) => s.theme)
  const narrow = useNarrow()

  // The drawer slides out; the desktop column does not linger at all, because it
  // is toggled with ⌘\ and the editor beside it must reclaim the width at once.
  const [held, sliding] = useLingering(sidebarOpen || null, 200)
  const leaving = narrow && sliding
  const showSidebar = sidebarOpen || (narrow && held !== null)

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
    // Short while editing, so the tab reads as the note; descriptive on the
    // landing page, which is the one that gets shared and indexed.
    document.title = name ? `${name} — edit.computer` : SITE_TITLE
  }, [activePath])

  if (!vault) {
    return (
      <>
        <Welcome />
        <DialogHost />
      </>
    )
  }

  return (
    <div className="app">
      <DialogHost />
      {settingsOpen && <Settings />}
      {showSidebar && (
        <>
          <Sidebar closing={leaving} />
          {/* only visible at the drawer breakpoint; tap-outside to close */}
          <div className={`scrim${leaving ? ' is-closing' : ''}`} onClick={toggleSidebar} />
        </>
      )}
      <main className="main">
        {!sidebarOpen && (
          <button
            className="icon-btn sidebar-toggle"
            title="Show sidebar (⌘\)"
            onClick={toggleSidebar}
          >
            <SidebarLeft size={18} />
          </button>
        )}
        {activePath ? (
          <Editor />
        ) : (
          <div className="empty-state">Select a note, or make one from the sidebar</div>
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
      <h1>edit.computer</h1>
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
      <div className="welcome-foot">
        <p>
          Files stay on your disk or your server — nothing is stored by this app, and it’s{' '}
          <a href="https://github.com/vladzima/mdd" target="_blank" rel="noreferrer">
            open source
          </a>
          .
        </p>
        <p>
          Made by{' '}
          <a href="https://x.com/vladzima" target="_blank" rel="noreferrer">
            Vlad Arbatov
          </a>
        </p>
      </div>
    </div>
  )
}
