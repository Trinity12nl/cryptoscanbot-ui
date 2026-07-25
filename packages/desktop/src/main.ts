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

// Persisted app config: the chosen engine data folder (the C# engine's `-f "datafolder"`) and the
// SignalR live-link toggle. Lives in Electron's per-user data dir, separate from the engine's data.
interface AppConfig { dataDir?: string | null; signalrEnabled?: boolean; signalrPort?: number }
const DEFAULT_SIGNALR_PORT = 5200
function configPath(): string { return join(app.getPath('userData'), 'config.json') }

function readConfig(): AppConfig {
  try { return JSON.parse(readFileSync(configPath(), 'utf8')) as AppConfig } catch { return {} }
}
function writeConfig(cfg: AppConfig): void {
  try { writeFileSync(configPath(), JSON.stringify(cfg, null, 2)) } catch { /* non-fatal */ }
}
/** Merge a patch into the persisted config, so writing one setting never wipes the others. */
function updateConfig(patch: Partial<AppConfig>): void { writeConfig({ ...readConfig(), ...patch }) }

/** Current data folder + the DB path the bridge resolves from it (null dataDir = default location). */
function dataFolderState(): { dataDir: string | null; dbPath: string } {
  const dataDir = readConfig().dataDir ?? null
  return { dataDir, dbPath: resolveDbPath({ dataDir: dataDir ?? undefined }) }
}

/** Current SignalR live-link toggle state (our bridge-side switch). */
function signalrState(): { enabled: boolean; port: number } {
  const cfg = readConfig()
  return { enabled: cfg.signalrEnabled === true, port: cfg.signalrPort ?? DEFAULT_SIGNALR_PORT }
}

/** (Re)start the in-process bridge against the configured data folder + SignalR toggle. No-op in dev
 * (external bridge). */
function startOrRestartBridge(): void {
  if (DEV_URL) return
  bridge?.close()
  const dataDir = readConfig().dataDir ?? undefined
  const sr = signalrState()
  const signalrUrl = sr.enabled ? `http://localhost:${sr.port}/signalr/signals` : undefined
  bridge = startBridgeDefault(PORT, { staticDir: webDistDir(), dataDir, signalrUrl })
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
  updateConfig({ dataDir: res.filePaths[0] })
  startOrRestartBridge()
  mainWindow?.webContents.reload()
  return dataFolderState()
})

// Set the data folder directly to a known-good path (the banner's one-click "Use this folder"
// suggestion). Same effect as picking it in the dialog, without opening one. Ignores empty input.
ipcMain.handle('csb:setDataFolder', (_e, dir: unknown) => {
  if (typeof dir === 'string' && dir) {
    updateConfig({ dataDir: dir })
    startOrRestartBridge()
    mainWindow?.webContents.reload()
  }
  return dataFolderState()
})

ipcMain.handle('csb:clearDataFolder', () => {
  updateConfig({ dataDir: null })
  startOrRestartBridge()
  mainWindow?.webContents.reload()
  return dataFolderState()
})

// IPC: the SignalR live-link toggle (our bridge-side switch). Enabling restarts the in-process bridge
// so it connects to the engine's hub; the engine must also have SignalREnabled=true and be running.
ipcMain.handle('csb:getSignalr', () => signalrState())

ipcMain.handle('csb:setSignalr', (_e, enabled: unknown) => {
  updateConfig({ signalrEnabled: enabled === true })
  startOrRestartBridge()
  // No page reload here (unlike the data-folder change): the live link doesn't change the dataset
  // (same DB), so the renderer's WebSocket just reconnects to the restarted bridge and the toggle
  // status updates in place - the Settings modal stays open so you see it go live.
  return signalrState()
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
