# mdd

Browser-based local-first markdown editor for a folder of `.md` files (e.g. an Obsidian vault). Inspired by [writer-computer](https://github.com/joelbqz/writer-computer), but running entirely in the browser via the File System Access API — no server, nothing uploaded.

Requires a Chromium browser (Chrome, Edge, Arc, Brave); Firefox and Safari don't support `showDirectoryPicker()`.

## Features

- Open a local vault folder with read/write access; the grant persists across sessions (one-click re-confirm)
- File tree sidebar (resizable, persisted) with recent files, create, rename, delete; `.obsidian`, `.git` etc. ignored
- Live-preview editing: syntax marks hide until the cursor touches the element (Obsidian/writer.computer style)
- Rendered tables, inline images (`![](path)` and `![[embed]]`), clickable checkboxes, horizontal rules
- Wikilinks `[[Note]]` / `[[Note|alias]]` — click to navigate, creates the note if missing
- Outline panel with click-to-jump and scroll position tracking
- Autosave (800 ms idle) plus ⌘S; picks up external edits (Obsidian, sync) on window focus
- Word count, dark mode, ⌘\ toggles the sidebar, restores your last-open note

## Development

```
npm install
npm run dev
```

`npm run build` typechecks and bundles; `npm run lint` runs oxlint.

## Remote vault (over Cloudflare Tunnel)

`agent/server.mjs` is a dependency-free Node file server. Run it on the machine
that holds your vault, expose it with `cloudflared`, then use **Connect to
server** on the app's welcome screen (the vault name in the sidebar switches
vaults). Setup on the server:

```
# 1. copy the agent over
scp agent/server.mjs you@server:~/mdd-agent/

# 2. run it (localhost only) with a token you generate
openssl rand -hex 32   # this is the token you'll paste into the app
MDD_TOKEN=<token> node ~/mdd-agent/server.mjs /path/to/vault

# 3. connect the tunnel (as a service; token from the Cloudflare tunnel)
sudo cloudflared service install <tunnel-token>
```

DNS: proxied CNAME `vault.edit.computer` → `<tunnel-id>.cfargotunnel.com`.
The agent only accepts requests with the bearer token, jails paths to the vault
dir, and answers CORS only for `https://edit.computer` (override: `MDD_ORIGIN`,
comma-separated — add `http://localhost:5173` for dev). `node agent/test_agent.mjs`
is the self-check.
