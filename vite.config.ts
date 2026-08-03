import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'node-rsa': new URL('./src/nodeRsaStub.ts', import.meta.url).pathname,
    },
  },
})
