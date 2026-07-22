// Library barrel: what other packages (the Electron main process, tests) import. It does NOT
// start anything on import - the runnable CLI lives in cli.ts.
export { startBridgeDefault } from './bootstrap.js'
export { startBridge } from './server.js'
export { SqliteDataSource, defaultDbPath } from './sqlite-source.js'
export { TickerSource } from './ticker-source.js'
export { SettingsSource, defaultSettingsPath } from './settings-source.js'
