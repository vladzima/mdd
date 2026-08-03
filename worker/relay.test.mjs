#!/usr/bin/env node
// Self-check for the /relay WebSocket→TCP pipe. Verifies BOTH directions: a relay
// that only forwards server→client looks alive (you get the SSH banner) but hangs
// forever, which is exactly the bug this guards against.
//
// Uses github.com:22, a public SSH endpoint: it answers a client identification
// string with its KEXINIT, so a reply larger than the banner proves our write
// arrived. Run: node worker/relay.test.mjs [wss://host/relay]
import assert from 'node:assert'

const base = process.argv[2] ?? 'wss://edit.computer/relay'
const origin = new URL(base.replace(/^ws/, 'http')).origin

const result = await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${base}?host=github.com&port=22`, { headers: { Origin: origin } })
  ws.binaryType = 'arraybuffer'
  let bytes = 0
  let sawBanner = false
  ws.onopen = () => ws.send(new TextEncoder().encode('SSH-2.0-mdd-relay-check\r\n'))
  ws.onmessage = (e) => {
    bytes += e.data.byteLength
    if (Buffer.from(e.data).toString('latin1').includes('SSH-2.0-')) sawBanner = true
    if (bytes > 200) resolve({ bytes, sawBanner }) // banner alone is ~17 bytes
  }
  ws.onclose = (e) => reject(new Error(`relay closed early: ${e.code} ${e.reason}`))
  ws.onerror = () => reject(new Error('relay connection failed'))
  setTimeout(() => reject(new Error(`relay stalled: only ${bytes} bytes back`)), 20000)
})

assert.ok(result.sawBanner, 'expected the SSH banner (server → client direction)')
assert.ok(result.bytes > 200, 'expected KEXINIT too (client → server direction)')
console.log(`relay self-check OK (${result.bytes} bytes both ways)`)
process.exit(0)
