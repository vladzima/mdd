// SSH connection config + host key pins. Kept apart from ssh.ts so the store and
// welcome screen can read them without pulling in the SSH libraries.

const SSH_KEY = 'mdd:ssh'
const HOSTKEYS = 'mdd:ssh-hostkeys'

export interface SshConfig {
  host: string
  port: number
  username: string
  path: string
  password?: string // only stored if the user chose to remember it
  privateKey?: string
  passphrase?: string // for an encrypted key file
}

export function savedSsh(): SshConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(SSH_KEY) ?? '')
    return typeof v?.host === 'string' && typeof v?.username === 'string' ? v : null
  } catch {
    return null
  }
}

export function saveSsh(cfg: SshConfig, rememberSecret: boolean): void {
  const { password, privateKey, passphrase, ...rest } = cfg
  localStorage.setItem(
    SSH_KEY,
    JSON.stringify(rememberSecret ? { ...rest, password, privateKey, passphrase } : rest),
  )
}

export function hostKeyStore(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(HOSTKEYS) ?? '{}')
  } catch {
    return {}
  }
}

export function pinHostKey(hostId: string, fingerprint: string): void {
  localStorage.setItem(HOSTKEYS, JSON.stringify({ ...hostKeyStore(), [hostId]: fingerprint }))
}

export function forgetHostKey(hostId: string): void {
  const store = hostKeyStore()
  delete store[hostId]
  localStorage.setItem(HOSTKEYS, JSON.stringify(store))
}
