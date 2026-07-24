import type {
  EngineInfo, ScannerDataSource, Signal, SignalBarometer, SignalTrend, SymbolRow,
} from '@csb/shared'
import type { SqliteDataSource } from './sqlite-source.js'
import type { SignalrSource } from './signalr-source.js'

/**
 * Phase B data source. Composes the Phase-A SQLite oracle (SqliteDataSource) with the engine's
 * SignalR hub (SignalrSource) behind the same ScannerDataSource seam, so the UI never changes.
 *
 * Division of labour:
 *  - The SQLite oracle stays the SOURCE OF TRUTH for signal payloads, history and symbols - it has
 *    every field (trend %, rsi, ...) and full history. SignalR carries only newly-created signals.
 *  - SignalR provides (1) REAL liveness (a live hub connection == engine running now) and (2) a
 *    near-instant push trigger: on a ReceiveSignal we poke the oracle to poll immediately rather
 *    than wait up to 1.5s. So there is a single emit path (the oracle poll) - no de-dup needed.
 *  - The hub DTO also carries per-signal barometer + multi-timeframe trend that the oracle lacks;
 *    we stash those by signal id and merge them onto the matching signal when the oracle emits it.
 *
 * Degrades cleanly: when the hub is absent/disabled the SignalR client just stays disconnected,
 * liveness falls back to the oracle's DB-exists check, and behaviour is identical to Phase A.
 */
export class HybridDataSource implements ScannerDataSource {
  private lastSignalrMs: number | null = null
  private readonly snapshots = new Map<number, { barometer: SignalBarometer; trend: SignalTrend }>()
  private readonly unsubs: Array<() => void> = []

  constructor(
    private readonly sqlite: SqliteDataSource,
    private readonly signalr: SignalrSource,
  ) {
    this.unsubs.push(this.signalr.onSignal((snap) => {
      // Stash the oracle-absent barometer/trend for enrichment (bounded to avoid unbounded growth).
      this.snapshots.set(snap.id, { barometer: snap.barometer, trend: snap.trend })
      if (this.snapshots.size > 500) {
        const oldest = this.snapshots.keys().next().value
        if (oldest !== undefined) this.snapshots.delete(oldest)
      }
      this.lastSignalrMs = Date.now()
      // Near-instant push: the oracle holds the full-fidelity row, so poke it to poll right now.
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

  /** Merge any stashed barometer/trend snapshot onto a signal (non-destructive; size-bounded). */
  private enrich(s: Signal): Signal {
    const snap = this.snapshots.get(s.id)
    return snap ? { ...s, barometer: snap.barometer, trend: snap.trend } : s
  }

  async info(): Promise<EngineInfo> {
    const base = await this.sqlite.info()
    // Real liveness first: a live hub connection means the engine is definitively running. Only when
    // the hub is not connected do we fall back to the oracle's "the DB file exists" guess.
    const connected = this.signalr.isConnected() || base.connected
    const lastChangeMs = Math.max(base.lastChangeMs ?? 0, this.lastSignalrMs ?? 0) || null
    return { ...base, connected, lastChangeMs }
  }

  async getSignals(opts?: { limit?: number; sinceMs?: number }): Promise<Signal[]> {
    const signals = await this.sqlite.getSignals(opts)
    return signals.map((s) => this.enrich(s))
  }

  getSymbols(opts?: { exchange?: string }): Promise<SymbolRow[]> {
    return this.sqlite.getSymbols(opts)
  }

  subscribeSignals(cb: (signals: Signal[]) => void): () => void {
    return this.sqlite.subscribeSignals((signals) => cb(signals.map((s) => this.enrich(s))))
  }

  close(): void {
    for (const u of this.unsubs) u()
    this.signalr.close()
    this.sqlite.close()
    this.snapshots.clear()
  }
}
