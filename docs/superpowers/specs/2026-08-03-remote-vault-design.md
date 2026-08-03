# Remote vault over Cloudflare Tunnel

Approved 2026-08-03. Adds an in-app option to open a markdown vault that lives on a
remote server, plus a way to switch vaults without clearing site data.

## Architecture

Three pieces:

1. **`agent/server.mjs`** — single-file Node script (no deps, `node:http`) run on the
   remote server, rooted at a vault dir passed as argv. Listens on localhost only;
   exposed publicly by `cloudflared` at `vault.edit.computer`.
2. **Vault abstraction in the app** — a `Vault` interface (`walk`, `read`, `mtime`,
   `write`, `create`, `delete`, `rename`, `assetFile`). `LocalVault` wraps the existing
   File System Access code unchanged; `RemoteVault` is a thin fetch client. `store.ts`
   holds a `Vault` instead of a raw `FileSystemDirectoryHandle`.
3. **UI** — Welcome screen gains "Connect to server" (URL + token, persisted in
   localStorage for auto-reconnect). Sidebar vault name becomes a "Switch vault"
   button that returns to Welcome; saved local handle and remote config both stay, so
   Welcome offers "Reopen X" / "Reconnect Y".

## Agent API

All requests require `Authorization: Bearer <token>` (token from `MDD_TOKEN` env;
agent refuses to start without it).

- `GET /list` → `[{ path, mtime }]`, flat, all files, dot-segments skipped. The app
  builds the tree and wikilink/asset indexes client-side; the agent stays dumb.
- `GET /file?path=` → raw bytes + `X-Mtime` header. `HEAD` same, no body (mtime poll).
- `PUT /file?path=` → writes body (creates parent dirs) → `{ mtime }`.
- `DELETE /file?path=` → 204.

Rename stays client-side (read + write + delete), same as the local impl.

## Security (not simplified away)

- Constant-time token compare (`crypto.timingSafeEqual` over digests).
- Path jail: resolved path must stay under the vault root; any `..` or dot-segment
  rejected.
- CORS allowlist: `https://edit.computer` (override via `MDD_ORIGIN`, comma-separated,
  for dev).

## Deployment

Remotely-managed Cloudflare Tunnel created via API from this machine: tunnel +
ingress config (`vault.edit.computer` → `http://localhost:8443`) + proxied DNS CNAME.
User runs `cloudflared` on the server with the tunnel token.

## Testing

`agent/test_agent.mjs`: starts the agent on a temp dir, exercises list/read/write/
delete, asserts auth is required and `..` traversal is rejected. Plain asserts, no
framework.

## Skipped (YAGNI)

Multiple saved remotes, file watching/live sync (existing mtime check on window focus
covers it), auth beyond bearer token, offline cache.
