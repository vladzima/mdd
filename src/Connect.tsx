import { useState } from 'react'
import { useStore } from './store'
import { savedSsh } from './sshConfig'

// SSH connect form: host, username, password or key, vault path. Nothing to install
// on the server — the browser speaks SSH through the app's /relay pipe.
export function Connect({ onCancel }: { onCancel: () => void }) {
  const saved = savedSsh()
  const connectSsh = useStore((s) => s.connectSsh)
  const [host, setHost] = useState(saved?.host ?? '')
  const [port, setPort] = useState(String(saved?.port ?? 22))
  const [username, setUsername] = useState(saved?.username ?? '')
  const [password, setPassword] = useState(saved?.password ?? '')
  const [privateKey, setPrivateKey] = useState(saved?.privateKey ?? '')
  const [keyName, setKeyName] = useState('')
  const [passphrase, setPassphrase] = useState(saved?.passphrase ?? '')
  const [path, setPath] = useState(saved?.path ?? '')
  const [remember, setRemember] = useState(Boolean(saved?.password || saved?.privateKey))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await connectSsh(
        {
          host: host.trim(),
          port: Number(port) || 22,
          username: username.trim(),
          path: path.trim(),
          ...(privateKey ? { privateKey, passphrase: passphrase || undefined } : { password }),
        },
        remember,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="connect" onSubmit={(e) => void submit(e)}>
      <div className="connect-row">
        <input
          className="text-input grow"
          placeholder="Host (example.com)"
          value={host}
          autoFocus
          onChange={(e) => setHost(e.currentTarget.value)}
        />
        <input
          className="text-input port"
          placeholder="22"
          value={port}
          onChange={(e) => setPort(e.currentTarget.value)}
        />
      </div>
      <input
        className="text-input"
        placeholder="Username"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.currentTarget.value)}
      />
      {privateKey ? (
        <>
          <div className="connect-row key-loaded">
            <span className="grow">{keyName ? `Key: ${keyName}` : 'Private key loaded'}</span>
            <button type="button" className="link-btn" onClick={() => setPrivateKey('')}>
              use a password
            </button>
          </div>
          <input
            className="text-input"
            type="password"
            placeholder="Key passphrase (leave blank if none)"
            value={passphrase}
            onChange={(e) => setPassphrase(e.currentTarget.value)}
          />
        </>
      ) : (
        <div className="connect-row">
          <input
            className="text-input grow"
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <label className="btn file-btn">
            Use key
            <input
              type="file"
              hidden
              onChange={async (e) => {
                const file = e.currentTarget.files?.[0]
                if (file) {
                  setKeyName(file.name)
                  setPrivateKey(await file.text())
                }
              }}
            />
          </label>
        </div>
      )}
      <input
        className="text-input"
        placeholder="Vault path (e.g. notes, or leave blank for home)"
        value={path}
        onChange={(e) => setPath(e.currentTarget.value)}
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.currentTarget.checked)}
        />
        Remember on this device (stores the {privateKey ? 'key' : 'password'} in this browser)
      </label>
      <div className="connect-row">
        <button className="btn primary grow" disabled={busy || !host || !username}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="connect-error">{error}</p>}
    </form>
  )
}
