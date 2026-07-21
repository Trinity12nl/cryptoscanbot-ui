import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The web app talks to the local bridge (Node HTTP+WS reading the C# oracle). In dev we proxy
// /api and /ws to the bridge so the browser has one origin; in Electron the same paths are used.
const BRIDGE = process.env.CSB_BRIDGE_URL ?? 'http://127.0.0.1:4319'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5319,
    proxy: {
      '/api': { target: BRIDGE, changeOrigin: true },
      '/ws': { target: BRIDGE, ws: true, changeOrigin: true },
    },
  },
})
