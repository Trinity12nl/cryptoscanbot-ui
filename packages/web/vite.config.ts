import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The web app talks to the local bridge (Node HTTP+WS reading the C# oracle). In dev we proxy
// /api and /ws to the bridge so the browser has one origin; in Electron the same paths are used.
const BRIDGE = process.env.CSB_BRIDGE_URL ?? 'http://127.0.0.1:4319'

// Bake the app version into the bundle (dev + packaged) so the UI can show which build a user is on.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5319,
    host: true, // expose on the LAN so the UI is reachable from other devices (phone/tablet)
    proxy: {
      '/api': { target: BRIDGE, changeOrigin: true },
      '/ws': { target: BRIDGE, ws: true, changeOrigin: true },
    },
  },
})
