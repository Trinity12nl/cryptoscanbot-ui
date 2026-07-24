import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startBridgeDefault, resolveDbPath } from '@csb/bridge'

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
let mainWindow: BrowserWindow | null = null

// Persisted app config: the chosen engine data folder (the C# engine's `-f "datafolder"`). Lives in
// Electron's per-user data dir, separate from the engine's own data.
interface AppConfig { dataDir?: string | null }
function configPath(): string { return join(app.getPath('userData'), 'config.json') }

function readConfig(): AppConfig {
  try { return JSON.parse(readFileSync(configPath(), 'utf8')) as AppConfig } catch { return {} }
}
function writeConfig(cfg: AppConfig): void {
  try { writeFileSync(configPath(), JSON.stringify(cfg, null, 2)) } catch { /* non-fatal */ }
}

/** Current data folder + the DB path the bridge resolves from it (null dataDir = default location). */
function dataFolderState(): { dataDir: string | null; dbPath: string } {
  const dataDir = readConfig().dataDir ?? null
  return { dataDir, dbPath: resolveDbPath({ dataDir: dataDir ?? undefined }) }
}

/** (Re)start the in-process bridge against the configured data folder. No-op in dev (external bridge). */
function startOrRestartBridge(): void {
  if (DEV_URL) return
  bridge?.close()
  const dataDir = readConfig().dataDir ?? undefined
  bridge = startBridgeDefault(PORT, { staticDir: webDistDir(), dataDir })
}

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
    title: 'CryptoScanBot-ui',
    backgroundColor: '#18181b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.cjs'),
    },
  })
  mainWindow = win

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

// IPC: let the UI read/change the engine data folder (exposed to the renderer via preload as
// window.csb). Changing it re-points the in-process bridge and reloads the page so the UI refetches.
ipcMain.handle('csb:getDataFolder', () => dataFolderState())

ipcMain.handle('csb:pickDataFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select the engine data folder',
    message: 'The folder the CryptoScanBot engine writes to (its -f "datafolder").',
    properties: ['openDirectory'],
  })
  if (res.canceled || res.filePaths.length === 0) return null
  writeConfig({ dataDir: res.filePaths[0] })
  startOrRestartBridge()
  mainWindow?.webContents.reload()
  return dataFolderState()
})

ipcMain.handle('csb:clearDataFolder', () => {
  writeConfig({ dataDir: null })
  startOrRestartBridge()
  mainWindow?.webContents.reload()
  return dataFolderState()
})

void app.whenReady().then(() => {
  let url: string
  if (DEV_URL) {
    url = DEV_URL
  } else {
    startOrRestartBridge()
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
