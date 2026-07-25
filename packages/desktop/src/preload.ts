import { contextBridge, ipcRenderer } from 'electron'

/** Where the bridge is reading the engine's data. `dataDir` is null when the default path is used. */
export interface DataFolderState {
  dataDir: string | null
  dbPath: string
}

/** The SignalR live-link toggle (our bridge-side switch) + the port it targets. */
export interface SignalrState {
  enabled: boolean
  port: number
}

// Exposed to the web UI as `window.csb` (contextIsolation is on, so this is the only channel). Lets
// the user point the app at an engine started with `-f "datafolder"`. Desktop-only: in the browser
// this object is simply absent.
contextBridge.exposeInMainWorld('csb', {
  getDataFolder: (): Promise<DataFolderState> => ipcRenderer.invoke('csb:getDataFolder'),
  /** Opens a native folder picker; resolves to the new state, or null if the user cancelled. */
  pickDataFolder: (): Promise<DataFolderState | null> => ipcRenderer.invoke('csb:pickDataFolder'),
  /** Sets the data folder directly to a known path (the banner's one-click suggestion fix). */
  setDataFolder: (dir: string): Promise<DataFolderState> =>
    ipcRenderer.invoke('csb:setDataFolder', dir),
  /** Reverts to the default OS location. */
  clearDataFolder: (): Promise<DataFolderState> => ipcRenderer.invoke('csb:clearDataFolder'),
  /** Read the SignalR live-link toggle (our bridge-side switch). */
  getSignalr: (): Promise<SignalrState> => ipcRenderer.invoke('csb:getSignalr'),
  /** Enable/disable the SignalR live link; restarts the bridge (no reload - the live socket
   * reconnects and the status updates in place). */
  setSignalr: (enabled: boolean): Promise<SignalrState> =>
    ipcRenderer.invoke('csb:setSignalr', enabled),
})
