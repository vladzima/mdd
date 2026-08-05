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
- New notes name themselves from their first `# heading` once you move off the title line; a name you set yourself is never overwritten, and an existing file is never replaced
- Autosave (800 ms idle) plus ⌘S; picks up external edits (Obsidian, sync) on window focus
- Word count, dark mode, ⌘\ toggles the sidebar, restores your last-open note

## Phone and tablet

Both sidebars resize by dragging with a finger, and touch targets, row actions
and the resize strips grow on a coarse pointer (hover-only affordances are
unreachable without a mouse).

Under 700px the layout switches: the file tree becomes an overlay drawer that
closes when you pick a note or tap outside it, the outline panel drops out, and
the editor takes the full width. Renaming uses the platform's own dialog rather
than the inline field, which the on-screen keyboard would cover. The editor does
not steal focus on touch, so the keyboard only appears when you tap into the text.

A phone can't open a local folder — no mobile browser implements
`showDirectoryPicker()` — so use **Connect over SSH** there.

## Development

```
npm install
npm run dev
```

`npm run build` typechecks and bundles; `npm run lint` runs oxlint.

Tests, all against real implementations rather than mocks:

| command | what it covers |
| --- | --- |
| `npm test` | SFTP client + `SshVault` against a throwaway sshd |
| `npm run test:relay` | the Worker's WebSocket↔TCP relay, both directions |
| `npm run test:layout` | touch resizing and the phone drawer, in real Chromium |

`test:layout` needs a build plus `npm i --no-save playwright-core
@playwright/browser-chromium`. It serves `dist/` with its own relay and sshd, so
the browser connects over SSH exactly as it does in production. Set
`SHOTS=<dir>` to also write phone and tablet screenshots.


## Remote vault over SSH

Open a vault that lives on any server you can already SSH into — nothing to
install there, just sshd with its usual SFTP subsystem. On the welcome screen
pick **Connect over SSH** and give it host, username, password (or a private key
file) and the vault path. The vault name in the sidebar switches vaults.

How it works: the browser speaks SSH end-to-end using a JavaScript SSH client;
the app's Worker exposes `/relay`, a WebSocket-to-TCP pipe to port 22, because
browsers can't open TCP sockets. Credentials and file contents are encrypted
before they leave the page — the relay only ever sees ciphertext.

Notes:
- Host keys are pinned on first connect (trust-on-first-use). A changed key
  aborts the connection with a warning rather than reconnecting silently.
- The password or key is only stored in the browser if you tick "Remember on
  this device"; otherwise you re-enter it each session.
- Key files must be RSA or ECDSA (PEM or PKCS#8) — the browser SSH client does
  not implement ed25519.
- `npm test` runs the SFTP/vault self-check against a throwaway sshd, using the
  same WebCrypto code path browsers take.
