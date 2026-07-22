import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { startBridgeDefault } from '@csb/bridge'

/**
 * Electron shell. Two modes:
 *  - dev (CSB_DEV_URL set): load the Vite dev server for HMR; the bridge runs as the standalone
 *    `pnpm dev` process, reached via Vite's proxy. We do NOT start a bridge here (avoids a port clash).
 *  - packaged: start the bridge IN THIS PROCESS, serving the built web UI, and load its URL. One
 *    process, one origin, no proxy.
 */
const PORT = Number(process.env.CSB_BRIDGE_PORT ?? 4319)
const DEV_URL = process.env.CSB_DEV_URL

let bridge: { close: () => void } | null = null

function webDistDir(): string {
  // Packaged: web/dist is copied into the app resources. Dev: sibling package build output.
  return app.isPackaged
    ? join(process.resourcesPath, 'web')
    : join(__dirname, '..', '..', 'web', 'dist')
}

function createWindow(url: string): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'CryptoScanBot',
    backgroundColor: '#18181b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Keep the app on its own page: external links (charts, changelog) open in the real browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, target) => {
    if (target !== url) { e.preventDefault(); void shell.openExternal(target) }
  })

  void win.loadURL(url)
  if (DEV_URL) win.webContents.openDevTools({ mode: 'detach' })
}

void app.whenReady().then(() => {
  let url: string
  if (DEV_URL) {
    url = DEV_URL
  } else {
    bridge = startBridgeDefault(PORT, { staticDir: webDistDir() })
    url = `http://127.0.0.1:${PORT}/`
  }
  createWindow(url)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  bridge?.close()
  bridge = null
})
