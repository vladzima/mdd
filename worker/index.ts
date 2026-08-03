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

// Inbound WebSocket payloads are not always ArrayBuffers — the runtime hands us a
// Blob for binary frames, and `new Uint8Array(blob)` silently yields zero bytes,
// which looks exactly like a connection that hangs.
async function toBytes(data: unknown, encoder: TextEncoder): Promise<Uint8Array> {
  if (typeof data === 'string') return encoder.encode(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  throw new Error(`relay: unsupported message type ${Object.prototype.toString.call(data)}`)
}

export default {
  async fetch(req: Request, env: { ALLOW_PRIVATE?: string }, ctx: ExecutionContext): Promise<Response> {
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
    // Set only by `npm run dev:worker`, never in a deploy, so loopback targets
    // (a local sshd) are reachable while testing but not in production.
    const allowPrivate = env.ALLOW_PRIVATE === 'true'
    if (!hostname || hostname.length > 255 || (PRIVATE_IP.test(hostname) && !allowPrivate)) {
      return new Response('bad host', { status: 400 })
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return new Response('bad port', { status: 400 })
    }

    const [client, server] = Object.values(new WebSocketPair())
    server.accept()

    const socket = connect({ hostname, port }, { allowHalfOpen: false })

    // The message listener only buffers — it must not touch the socket. Socket I/O
    // stays inside the single task below, which owns the request's I/O context;
    // writing from the listener instead cancels the stream mid-connection.
    const outbound: unknown[] = []
    let wake: (() => void) | null = null
    let clientGone = false
    server.addEventListener('message', (e: MessageEvent) => {
      outbound.push(e.data)
      wake?.()
    })
    const finish = () => {
      clientGone = true
      wake?.()
    }
    server.addEventListener('close', finish)
    server.addEventListener('error', finish)

    const pumpToServer = async () => {
      const writer = socket.writable.getWriter()
      const encoder = new TextEncoder()
      while (!clientGone) {
        if (outbound.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve
          })
          wake = null
          continue
        }
        await writer.write(await toBytes(outbound.shift()!, encoder))
      }
      await writer.close().catch(() => {})
    }

    // pipeTo, not a read() loop: the runtime keeps the stream alive for the life of
    // the socket. A hand-rolled loop inside waitUntil delivered only the first chunk.
    const pumpToClient = () =>
      socket.readable.pipeTo(
        new WritableStream({
          write: (chunk: Uint8Array) => {
            server.send(chunk)
          },
        }),
      )

    ctx.waitUntil(
      Promise.all([pumpToServer(), pumpToClient()])
        .then(() => server.close(1000, 'remote closed'))
        .catch((err) => {
          server.close(1011, String(err).slice(0, 100))
          return socket.close().catch(() => {})
        }),
    )

    return new Response(null, { status: 101, webSocket: client })
  },
}
