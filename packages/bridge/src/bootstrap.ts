import { SqliteDataSource, defaultDbPath } from './sqlite-source.js'
import { TickerSource } from './ticker-source.js'
import { SettingsSource } from './settings-source.js'
import { startBridge } from './server.js'

/**
 * One place that wires the full bridge together: SQLite oracle source + ccxt ticker + HTTP/WS
 * server, and keeps the ticker pointed at whatever exchange the engine reports. Both the CLI
 * entry (index.ts) and the Electron main process use this, so setup never diverges.
 */
export function startBridgeDefault(
  port: number, opts: { staticDir?: string } = {},
): { close: () => void } {
  const source = new SqliteDataSource()
  const ticker = new TickerSource()
  const settings = new SettingsSource()
  settings.start()
  // eslint-disable-next-line no-console
  console.log(`[bridge] reading oracle DB: ${process.env.CSB_DB_PATH || defaultDbPath()}`)

  // Point the ticker at the engine's exchange, and keep it in sync if that changes.
  const syncTickerExchange = async (): Promise<void> => {
    const info = await source.info()
    ticker.start(info.exchange)
  }
  void syncTickerExchange()
  const exchangeWatch = setInterval(() => void syncTickerExchange(), 30_000)

  const bridge = startBridge(source, ticker, port, { ...opts, settings })

  return {
    close: () => {
      clearInterval(exchangeWatch)
      bridge.close()
    },
  }
}
