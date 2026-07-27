import type {
  Barometer, BarometerGraph, EngineInfo, MarketIndicators, PriceMap, ScannerDataSource, Signal,
  SymbolRow,
} from '@csb/shared'
import type { SqliteDataSource } from './sqlite-source.js'
import type { SignalrSource } from './signalr-source.js'

/**
 * Phase B data source. Composes the Phase-A SQLite oracle (SqliteDataSource) with the engine's
 * SignalR hub (SignalrSource) behind the same ScannerDataSource seam, so the UI never changes.
 *
 * Division of labour:
 *  - The SQLite oracle is the SOURCE OF TRUTH for all signal data, history and symbols - it stores
 *    every field (including the per-timeframe barometer/trend), so we read everything from it.
 *  - SignalR provides only (1) REAL liveness (a live hub connection == engine running now) and (2) a
 *    near-instant push trigger: on a ReceiveSignal we poke the oracle to poll immediately rather
 *    than wait up to 1.5s. The oracle poll stays the single emit path, so no de-dup is needed.
 *
 * Degrades cleanly: when the hub is absent/disabled the SignalR client just stays disconnected,
 * liveness falls back to the oracle's DB-exists check, and behaviour is identical to Phase A.
 */
export class HybridDataSource implements ScannerDataSource {
  private lastSignalrMs: number | null = null
  private readonly unsubs: Array<() => void> = []

  constructor(
    private readonly sqlite: SqliteDataSource,
    private readonly signalr: SignalrSource,
  ) {
    this.unsubs.push(this.signalr.onSignal(() => {
      this.lastSignalrMs = Date.now()
      // Near-instant push: the oracle holds the full row, so poke it to poll right now.
      this.sqlite.pollNow()
    }))
    this.unsubs.push(this.signalr.onConnectionChange((connected) => {
      // eslint-disable-next-line no-console
      console.log(`[bridge] engine SignalR ${connected
        ? 'connected - live engine liveness ON'
        : 'disconnected - liveness falls back to DB-exists'}`)
    }))
    this.signalr.start()
  }

  async info(): Promise<EngineInfo> {
    const base = await this.sqlite.info()
    // Liveness: once the hub has ever connected, the engine is known to expose it, so the LIVE hub
    // connection is authoritative - a drop means the engine is gone even though its DB file lingers
    // (the whole point of Phase B: kill the engine -> offline, not "the .db still exists -> online").
    // Before any successful connect (e.g. an engine that never turned the hub on) we must NOT report
    // offline, so we fall back to the oracle's DB-exists check = exactly the Phase-A behaviour.
    const connected = this.signalr.hasEverConnected() ? this.signalr.isConnected() : base.connected
    const lastChangeMs = Math.max(base.lastChangeMs ?? 0, this.lastSignalrMs ?? 0) || null
    // The live link is enabled (this source only exists when it is); report whether it's connected now.
    return {
      ...base, connected, lastChangeMs,
      signalrEnabled: true, signalrConnected: this.signalr.isConnected(),
    }
  }

  getSignals(opts?: { limit?: number; sinceMs?: number }): Promise<Signal[]> {
    return this.sqlite.getSignals(opts)
  }

  getSymbols(opts?: { exchange?: string }): Promise<SymbolRow[]> {
    return this.sqlite.getSymbols(opts)
  }

  subscribeSignals(cb: (signals: Signal[]) => void): () => void {
    return this.sqlite.subscribeSignals(cb)
  }

  /** Push an info refresh the instant the hub connects or drops, so liveness (and the header's
   * Live/Polling mode) updates immediately instead of waiting for the server's periodic poll. */
  onInfoChange(cb: () => void): () => void {
    return this.signalr.onConnectionChange(() => cb())
  }

  // --- Phase B live market data: delegate straight to the SignalR hub client. ---

  subscribeBarometer(cb: (b: Barometer) => void): () => void {
    return this.signalr.onBarometer(cb)
  }

  getBarometers(): Barometer[] {
    return this.signalr.getBarometers()
  }

  subscribePrices(cb: (p: PriceMap) => void): () => void {
    return this.signalr.onPrices(cb)
  }

  getSignalrPrices(): PriceMap | null {
    return this.signalr.getLastPrices()
  }

  subscribeMarketIndicators(cb: (m: MarketIndicators) => void): () => void {
    return this.signalr.onMarketIndicators(cb)
  }

  getMarketIndicators(): MarketIndicators | null {
    return this.signalr.getLastMarketIndicators()
  }

  getBarometerGraph(quote: string, interval: string): Promise<BarometerGraph> {
    return this.signalr.getBarometerGraph(quote, interval)
  }

  close(): void {
    for (const u of this.unsubs) u()
    this.signalr.close()
    this.sqlite.close()
  }
}
