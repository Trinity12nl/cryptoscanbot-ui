import { SqliteDataSource, defaultDbPath } from './sqlite-source.js'
import { TickerSource } from './ticker-source.js'
import { startBridge } from './server.js'

const PORT = Number(process.env.CSB_BRIDGE_PORT ?? 4319)

const source = new SqliteDataSource()
const ticker = new TickerSource()
// eslint-disable-next-line no-console
console.log(`[bridge] reading oracle DB: ${process.env.CSB_DB_PATH || defaultDbPath()}`)

// Point the ticker at whatever exchange the engine reports, and keep it in sync if that changes.
async function syncTickerExchange(): Promise<void> {
  const info = await source.info()
  ticker.start(info.exchange)
}
void syncTickerExchange()
const exchangeWatch = setInterval(() => void syncTickerExchange(), 30_000)

const bridge = startBridge(source, ticker, PORT)

const shutdown = () => { clearInterval(exchangeWatch); bridge.close(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
