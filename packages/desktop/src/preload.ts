import { contextBridge, ipcRenderer } from 'electron'

/** Where the bridge is reading the engine's data. `dataDir` is null when the default path is used. */
export interface DataFolderState {
  dataDir: string | null
  dbPath: string
}

// Exposed to the web UI as `window.csb` (contextIsolation is on, so this is the only channel). Lets
// the user point the app at an engine started with `-f "datafolder"`. Desktop-only: in the browser
// this object is simply absent.
contextBridge.exposeInMainWorld('csb', {
  getDataFolder: (): Promise<DataFolderState> => ipcRenderer.invoke('csb:getDataFolder'),
  /** Opens a native folder picker; resolves to the new state, or null if the user cancelled. */
  pickDataFolder: (): Promise<DataFolderState | null> => ipcRenderer.invoke('csb:pickDataFolder'),
  /** Reverts to the default OS location. */
  clearDataFolder: (): Promise<DataFolderState> => ipcRenderer.invoke('csb:clearDataFolder'),
})
