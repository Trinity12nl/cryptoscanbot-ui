// Access to the Electron preload API (window.csb). Present only in the desktop app; in the browser /
// dev it's absent, and the data folder is set via the CSB_DATA_DIR env var on the bridge instead.

export interface DataFolderState {
  /** The chosen engine data folder, or null when the default OS location is used. */
  dataDir: string | null
  /** The oracle DB path the bridge resolves from it. */
  dbPath: string
}

export interface DesktopApi {
  getDataFolder(): Promise<DataFolderState>
  pickDataFolder(): Promise<DataFolderState | null>
  clearDataFolder(): Promise<DataFolderState>
}

declare global {
  interface Window { csb?: DesktopApi }
}

/** The desktop API when running in Electron, else null (browser / dev). */
export function getDesktop(): DesktopApi | null {
  return typeof window !== 'undefined' && window.csb ? window.csb : null
}
