import { useEffect } from 'react'
import { THEMES, useStore, type Theme } from './store'

const THEME_LABELS: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  vesper: 'Vesper',
}

export function Settings() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const tabSize = useStore((s) => s.tabSize)
  const setTabSize = useStore((s) => s.setTabSize)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSettingsOpen])

  return (
    <div className="settings-overlay" onMouseDown={() => setSettingsOpen(false)}>
      <div className="settings-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-title">Settings</div>

        <div className="settings-row">
          <span className="settings-label">Tab size</span>
          <div className="segmented">
            {[2, 4].map((n) => (
              <button
                key={n}
                className={`seg-btn${tabSize === n ? ' selected' : ''}`}
                onClick={() => setTabSize(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span className="settings-label">Theme</span>
          <div className="segmented">
            {THEMES.map((t) => (
              <button
                key={t}
                className={`seg-btn${theme === t ? ' selected' : ''}`}
                onClick={() => setTheme(t)}
              >
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
