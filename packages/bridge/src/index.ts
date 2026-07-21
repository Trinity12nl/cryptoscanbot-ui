import { SqliteDataSource, defaultDbPath } from './sqlite-source.js'
import { startBridge } from './server.js'

const PORT = Number(process.env.CSB_BRIDGE_PORT ?? 4319)

const source = new SqliteDataSource()
// eslint-disable-next-line no-console
console.log(`[bridge] reading oracle DB: ${process.env.CSB_DB_PATH || defaultDbPath()}`)

const bridge = startBridge(source, PORT)

const shutdown = () => { bridge.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
