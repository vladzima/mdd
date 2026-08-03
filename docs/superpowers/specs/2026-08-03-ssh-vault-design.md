# Remote vault over SSH

Replaces `2026-08-03-remote-vault-design.md`. That design asked every user to copy
an agent onto their server and run a Cloudflare Tunnel; this one asks for host,
username and password.

## Constraint

A browser cannot open a TCP socket, so something must relay bytes to port 22. The
relay must not become a place where credentials sit in the clear.

## Architecture

1. **`worker/index.ts`** — `/relay`, a WebSocket→TCP pipe on the app's own Worker
   (`run_worker_first: ["/relay"]` keeps it ahead of the SPA fallback). It pipes
   bytes and nothing else.
2. **`src/ssh.ts`** — runs a real SSH client (`@microsoft/dev-tunnels-ssh`) *in the
   page*, over that pipe. Because the SSH handshake is end-to-end, the relay sees
   only ciphertext: passwords, keys and file contents are never readable by the
   Worker or by Cloudflare.
3. **`src/sftp.ts`** — SFTP v3 client (the subset the vault needs) over an SSH
   channel. `SshVault` implements the same `Vault` interface as `LocalVault`, so
   the editor, wikilinks and autosave work unchanged.
4. **UI** — `src/Connect.tsx`: host, port, username, password or key file, vault
   path, and a "remember on this device" checkbox.

## Security

- **Host keys** are pinned on first connect (TOFU, SHA-256, in localStorage). A
  changed key aborts with an explanation instead of reconnecting.
- **Secrets** are kept in memory unless the user opts into remembering them; the
  checkbox says plainly what it stores and where.
- **The relay** refuses cross-origin browser requests and private/loopback address
  literals. Known ceiling: a non-browser client can forge `Origin` and use it as a
  TCP proxy — gate on a Turnstile token or signed nonce if abuse appears.

## Testing

`npm test` starts a throwaway sshd on a free port and drives `SshVault` through
walk / read / chunked write / unicode / create / rename / asset bytes / delete /
missing-file, with the SSH library forced onto its WebCrypto path (asserted) so the
test covers what browsers actually run.

## Removed

`agent/server.mjs`, `src/remote.ts` and the token UI — superseded, recoverable from
git history. The `mdd-vault` Cloudflare Tunnel created for that design is unused.

## Skipped (YAGNI)

Multiple saved servers, ed25519 keys (library lacks them), live file watching (the
existing on-focus mtime check covers external edits), agent-side search.
