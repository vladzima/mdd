import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Left alone, the minifier rewrites `max-width` as `@media (width<=700px)`,
  // which Safari only understands from 16.4 — an older iPad would silently drop
  // the whole phone layout.
  build: { cssTarget: 'safari15' },
  // Reaching the dev server through a tunnel means the Host header is the tunnel's,
  // which Vite rejects by default. A leading dot matches any subdomain.
  server: { allowedHosts: ['.ngrok.app', '.ngrok-free.app', '.exe.dev'] },
  resolve: {
    alias: {
      'node-rsa': new URL('./src/nodeRsaStub.ts', import.meta.url).pathname,
      stream: new URL('./src/streamStub.ts', import.meta.url).pathname,
    },
  },
})
