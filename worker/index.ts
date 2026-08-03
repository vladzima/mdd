// WebSocket → TCP relay so the browser can speak SSH to a server on port 22.
// The relay is a dumb pipe: SSH is negotiated end-to-end inside the browser, so
// credentials and file contents are encrypted before they reach this Worker.
//
// ponytail: the Origin check only stops other web pages — a non-browser client can
// forge it and use this as a generic TCP proxy. Gate it with a Turnstile token or a
// signed nonce if that ever shows up in the logs.

import { connect } from 'cloudflare:sockets'

const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

// Private/loopback/link-local literals: not reachable from the edge anyway, and
// refusing them keeps this from reading as an internal-network probe.
const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80:)/i

export default {
  async fetch(req: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname !== '/relay') return new Response('not found', { status: 404 })

    const origin = req.headers.get('Origin')
    if (!origin || (origin !== url.origin && !DEV_ORIGINS.has(origin))) {
      return new Response('forbidden origin', { status: 403 })
    }
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }

    const hostname = url.searchParams.get('host') ?? ''
    const port = Number(url.searchParams.get('port') ?? 22)
    if (!hostname || hostname.length > 255 || PRIVATE_IP.test(hostname)) {
      return new Response('bad host', { status: 400 })
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return new Response('bad port', { status: 400 })
    }

    const [client, server] = Object.values(new WebSocketPair())
    server.accept()

    const socket = connect({ hostname, port }, { allowHalfOpen: false })
    const writer = socket.writable.getWriter()

    server.addEventListener('message', (e: MessageEvent) => {
      const data = e.data
      void writer
        .write(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data))
        .catch(() => server.close(1011, 'write failed'))
    })
    server.addEventListener('close', () => void socket.close().catch(() => {}))
    server.addEventListener('error', () => void socket.close().catch(() => {}))

    ctx.waitUntil(
      (async () => {
        const reader = socket.readable.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            server.send(value)
          }
          server.close(1000, 'remote closed')
        } catch (err) {
          server.close(1011, String(err).slice(0, 100))
        }
      })(),
    )

    return new Response(null, { status: 101, webSocket: client })
  },
}
