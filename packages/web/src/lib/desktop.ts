// Access to the Electron preload API (window.csb). Present only in the desktop app; in the browser /
// dev it's absent, and the data folder is set via the CSB_DATA_DIR env var on the bridge instead.

export interface DataFolderState {
  /** The chosen engine data folder, or null when the default OS location is used. */
  dataDir: string | null
  /** The oracle DB path the bridge resolves from it. */
  dbPath: string
}

/** The SignalR live-link toggle (our bridge-side switch) + the port it targets. */
export interface SignalrState {
  enabled: boolean
  port: number
}

export interface DesktopApi {
  getDataFolder(): Promise<DataFolderState>
  pickDataFolder(): Promise<DataFolderState | null>
  /** Point the app straight at a known-good folder (the no-data banner's one-click suggestion). */
  setDataFolder(dir: string): Promise<DataFolderState>
  clearDataFolder(): Promise<DataFolderState>
  /** Read the SignalR live-link toggle. */
  getSignalr(): Promise<SignalrState>
  /** Enable/disable the SignalR live link (restarts the bridge; no reload - the live socket
   * reconnects and the status updates in place). */
  setSignalr(enabled: boolean): Promise<SignalrState>
}

declare global {
  interface Window { csb?: DesktopApi }
}

/** The desktop API when running in Electron, else null (browser / dev). */
export function getDesktop(): DesktopApi | null {
  return typeof window !== 'undefined' && window.csb ? window.csb : null
}
