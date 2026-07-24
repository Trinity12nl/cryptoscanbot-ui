import { SqliteDataSource, resolveDbPath } from './sqlite-source.js'
import { TickerSource } from './ticker-source.js'
import { SettingsSource } from './settings-source.js'
import { startBridge } from './server.js'

/**
 * One place that wires the full bridge together: SQLite oracle source + ccxt ticker + HTTP/WS
 * server, and keeps the ticker pointed at whatever exchange the engine reports. Both the CLI
 * entry (index.ts) and the Electron main process use this, so setup never diverges.
 *
 * `dataDir` points every source at a custom engine data folder (the C# engine's `-f "datafolder"`);
 * when omitted, the env vars / platform default apply.
 */
export function startBridgeDefault(
  port: number, opts: { staticDir?: string; dataDir?: string } = {},
): { close: () => void } {
  const source = new SqliteDataSource({ dataDir: opts.dataDir })
  const ticker = new TickerSource()
  const settings = new SettingsSource({ dataDir: opts.dataDir })
  settings.start()
  // eslint-disable-next-line no-console
  console.log(`[bridge] reading oracle DB: ${resolveDbPath({ dataDir: opts.dataDir })}`)

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
