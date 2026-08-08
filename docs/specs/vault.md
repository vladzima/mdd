# Vault access

A vault is a directory of plain `.md` files, edited in place. One small vault
interface, two implementations:

- **Local folder** — File System Access API (Chromium desktop only). The
  directory handle is kept in IndexedDB so the vault reopens next visit with a
  single confirmation.
- **SSH** — SSH + SFTP v3 clients running in the page. The Cloudflare Worker
  exposes `/relay`, a WebSocket-to-TCP pipe to port 22 that only ever carries
  ciphertext. Host keys are pinned on first use; a changed key refuses the
  connection with an explanation. Credentials are stored only when "Remember on
  this device" is ticked, otherwise in memory for the session.

Known limits: the browser SSH client speaks RSA and ECDSA, not ed25519; keys
must be PEM or PKCS#8 (common unusable formats are detected and explained).

# Tasks
