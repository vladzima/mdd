# edit.computer

A markdown editor that runs entirely in your browser and writes straight to your
own files — a local folder, or a directory on any server you can SSH into.

**[edit.computer](https://edit.computer)** — no account, no install, no upload.

It reads and writes plain `.md` files in place, so an Obsidian vault, a Jekyll
`_posts` directory, or a folder of notes all work as-is. Nothing is copied to a
server owned by this project: with a local folder the files never leave your
machine, and over SSH they go straight between your browser and your own box.

## Features

- **Live preview inline** — syntax marks hide until the cursor touches them, so
  you edit the rendered text rather than a split pane
- **Tables, images, task lists** rendered in place; `![](path)` and `![[embed]]`
  both resolve against the vault
- **Wikilinks** — `[[Note]]` and `[[Note|alias]]` navigate on click, and create
  the note if it doesn't exist yet
- **File tree** with folders, recent files, create, rename and delete
- **Outline panel** that tracks your scroll position and jumps on click
- **Self-naming notes** — a new note takes its name from the first `# heading`
  once you move off that line, and never overwrites a name you chose or a file
  that already exists
- **Autosave** on idle plus <kbd>⌘S</kbd>, and it picks up edits made elsewhere
  (Obsidian, Syncthing, git) when the window regains focus
- Dark mode, word count, adjustable tab size, and a
  [Vesper](https://github.com/raunofreiberg/vesper) theme
- Works on phones and tablets, including drag-to-resize by touch

## Opening a vault

Two ways in, with different browser requirements:

| | How | Works in |
| --- | --- | --- |
| **Local folder** | Pick a directory; the permission is remembered between visits | Chromium desktop only — Firefox and Safari don't implement `showDirectoryPicker()` |
| **Over SSH** | Host, username, password or key, and a path | Any modern browser, including iOS and Android |

No mobile browser can open a local folder, so SSH is the route on a phone or
iPad. There is nothing to install on the server — just the sshd and SFTP
subsystem that are already there.

## How it works

The editor is a static React + CodeMirror app on Cloudflare Workers. It talks to
a vault through one small interface, with two implementations:

- **Local** — the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_Access_API).
  The directory handle is kept in IndexedDB so the vault reopens on your next
  visit with a single confirmation.
- **SSH** — a JavaScript SSH client and an SFTP v3 client running *in the page*.
  Browsers can't open TCP sockets, so the Worker exposes `/relay`, a
  WebSocket-to-TCP pipe to port 22. The SSH session is established end to end
  from the browser, which means the relay only ever carries ciphertext: it never
  sees your password, your key, or your files.

Host keys are pinned on first connect (trust on first use). If a host key later
changes, the connection is refused with an explanation rather than reconnecting
silently.

Credentials are stored in the browser only if you tick "Remember on this
device"; otherwise they live in memory for the session.

### Known limits

- The browser SSH client implements RSA and ECDSA, not ed25519. Keys must be PEM
  or PKCS#8 — the app detects the common unusable formats and tells you the exact
  command to convert a copy.
- `/relay` checks the `Origin` header, which stops other web pages from using it,
  but a non-browser client can forge that header and use it as a generic TCP
  proxy. If you deploy your own, consider putting a Turnstile token or a signed
  nonce in front of it.
- Conflict handling is deliberately simple: if a file changed on disk while you
  have unsaved edits, your buffer wins. There is no merge UI.

## Development

```
npm install
npm run dev
```

`npm run build` typechecks and bundles, `npm run lint` runs oxlint.

The tests run against real implementations rather than mocks:

| command | what it covers |
| --- | --- |
| `npm test` | the SFTP client and vault operations against a throwaway sshd |
| `npm run test:relay` | the Worker's WebSocket↔TCP relay, in both directions |
| `npm run test:layout` | touch resizing, the phone drawer and note naming, in real Chromium |

`test:layout` needs a build plus `npm i --no-save playwright-core
@playwright/browser-chromium`. It stands up its own sshd, relay and static
server, so the browser connects over SSH exactly as it does in production. Set
`SHOTS=<dir>` to write phone and tablet screenshots as it goes.

## Deploying your own

```
npm run build
npx wrangler deploy
```

Change `name` in `wrangler.jsonc` first, and either drop the `routes` block to
use the generated `workers.dev` URL or point it at a domain in your own
Cloudflare account.

## License

[MIT](LICENSE) © Vlad Arbatov.

## Credits

Inspired by [writer-computer](https://github.com/joelbqz/writer-computer).
