// The SSH library and its key parsers are written for Node: they touch `Buffer`
// and `process` while their own modules evaluate. Set both before anything imports
// them. This cannot live at the top of ssh.ts — ESM evaluates every import before
// any module body code, so the library would load first and throw
// "Can't find variable: Buffer".
import { Buffer } from 'buffer'

// Loose record: @types/node types these globals strictly, and the shim is
// deliberately a subset of what Node provides.
const g = globalThis as unknown as Record<string, unknown>

g.Buffer ??= Buffer
g.global ??= globalThis // the random-bytes polyfill reads global.crypto while loading
g.setImmediate ??= (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
  setTimeout(fn, 0, ...args)
g.process ??= {
  env: {},
  versions: {}, // no `node` key: keeps the key parsers off their filesystem paths
  platform: 'browser',
  nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
    queueMicrotask(() => fn(...args)),
}
