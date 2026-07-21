import Database from 'better-sqlite3'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  EngineInfo, ScannerDataSource, Signal, SymbolRow, TradeSide,
} from '@csb/shared'
import { strategyName } from '@csb/shared'

/** Default oracle DB path per platform (where the C# engine writes on each OS). */
export function defaultDbPath(): string {
  const app = 'CryptoScanBot'
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', app, `${app}.db`)
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), app, `${app}.db`)
  }
  // linux / other: .NET SpecialFolder.ApplicationData -> ~/.config
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), app, `${app}.db`)
}

/** C# stores decimals as invariant-culture TEXT ("0.3982"). Parse leniently to number|null. */
function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

/** C# DateTime TEXT "YYYY-MM-DD HH:MM:SS" is UTC -> epoch ms. */
function dateMs(v: unknown): number | null {
  if (v == null) return null
  const s = String(v).trim().replace(' ', 'T')
  const ms = Date.parse(s.endsWith('Z') ? s : `${s}Z`)
  return Number.isNaN(ms) ? null : ms
}

interface SignalJoinRow {
  Id: number; ExchangeName: string | null; SymbolName: string | null; IntervalName: string | null
  Strategy: number; Side: number; SignalPrice: string | null; SignalVolume: string | null
  TrendPercentagePrimary: string | null; TrendPercentageSecondary: string | null
  BollingerBandsPercentage: string | null; EventText: string | null; OpenDate: string | null
}

function toSignal(r: SignalJoinRow): Signal {
  const side: TradeSide = r.Side === 1 ? 'short' : 'long'
  return {
    id: r.Id,
    exchange: r.ExchangeName ?? '',
    symbol: r.SymbolName ?? '',
    interval: r.IntervalName ?? '',
    strategyId: r.Strategy,
    strategy: strategyName(r.Strategy),
    side,
    price: num(r.SignalPrice),
    volume: num(r.SignalVolume),
    trendPrimary: num(r.TrendPercentagePrimary),
    trendSecondary: num(r.TrendPercentageSecondary),
    bbPercentage: num(r.BollingerBandsPercentage),
    eventText: r.EventText ?? '',
    openDateMs: dateMs(r.OpenDate),
  }
}

const SIGNAL_SELECT = `
  SELECT s.Id, ex.Name AS ExchangeName, sym.Name AS SymbolName, i.Name AS IntervalName,
         s.Strategy, s.Side, s.SignalPrice, s.SignalVolume,
         s.TrendPercentagePrimary, s.TrendPercentageSecondary, s.BollingerBandsPercentage,
         s.EventText, s.OpenDate
  FROM Signal s
  LEFT JOIN Symbol sym ON sym.Id = s.SymbolId
  LEFT JOIN Exchange ex ON ex.Id = s.ExchangeId
  LEFT JOIN Interval i ON i.Id = s.IntervalId`

/**
 * Phase B data source: reads the C# engine's SQLite oracle read-only (WAL-aware, so it sees the
 * engine's committed writes live) and polls for newly-inserted signals. Zero C# changes.
 */
export class SqliteDataSource implements ScannerDataSource {
  private readonly dbPath: string
  private db: Database.Database | null = null
  private lastId = 0
  private lastChangeMs: number | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(s: Signal[]) => void>()

  constructor(dbPath = process.env.CSB_DB_PATH || defaultDbPath()) {
    this.dbPath = dbPath
  }

  private open(): Database.Database | null {
    if (this.db) return this.db
    if (!existsSync(this.dbPath)) return null
    // readonly + not-immutable so WAL/shm are used and we see the live writer's commits.
    this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true })
    this.db.pragma('busy_timeout = 2000')
    return this.db
  }

  async info(): Promise<EngineInfo> {
    const connected = existsSync(this.dbPath)
    let exchange: string | null = null
    const db = this.open()
    if (db) {
      try {
        const row = db.prepare(
          `SELECT Name FROM Exchange WHERE IsSupported = 1 ORDER BY LastTimeFetched DESC LIMIT 1`,
        ).get() as { Name?: string } | undefined
        exchange = row?.Name ?? null
      } catch { /* schema may differ; leave null */ }
    }
    return { exchange, dbPath: this.dbPath, connected, lastChangeMs: this.lastChangeMs }
  }

  async getSignals(opts: { limit?: number; sinceMs?: number } = {}): Promise<Signal[]> {
    const db = this.open()
    if (!db) return []
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000)
    const rows = db.prepare(
      `${SIGNAL_SELECT} ORDER BY s.Id DESC LIMIT ?`,
    ).all(limit) as SignalJoinRow[]
    const signals = rows.map(toSignal)
    return opts.sinceMs != null
      ? signals.filter((s) => (s.openDateMs ?? 0) >= opts.sinceMs!)
      : signals
  }

  async getSymbols(opts: { exchange?: string } = {}): Promise<SymbolRow[]> {
    const db = this.open()
    if (!db) return []
    const rows = (opts.exchange
      ? db.prepare(
          `SELECT Name, Base, Quote, ExchangeName, Volume, Status FROM Symbol WHERE ExchangeName = ? ORDER BY Name`,
        ).all(opts.exchange)
      : db.prepare(
          `SELECT Name, Base, Quote, ExchangeName, Volume, Status FROM Symbol ORDER BY Name`,
        ).all()) as Array<{
          Name: string; Base: string | null; Quote: string | null
          ExchangeName: string | null; Volume: string | null; Status: number | null
        }>
    return rows.map((r) => ({
      exchange: r.ExchangeName ?? '',
      name: r.Name,
      base: r.Base ?? '',
      quote: r.Quote ?? '',
      volume: num(r.Volume),
      status: r.Status ?? null,
    }))
  }

  subscribeSignals(cb: (signals: Signal[]) => void): () => void {
    this.listeners.add(cb)
    this.ensurePolling()
    return () => { this.listeners.delete(cb) }
  }

  /** Seed lastId and poll for new signals; push deltas to subscribers. */
  private ensurePolling(): void {
    if (this.pollTimer) return
    const db = this.open()
    if (db) {
      const row = db.prepare(`SELECT MAX(Id) AS m FROM Signal`).get() as { m: number | null }
      this.lastId = row.m ?? 0
    }
    this.pollTimer = setInterval(() => this.poll(), 1500)
  }

  private poll(): void {
    const db = this.open()
    if (!db) return
    try {
      const rows = db.prepare(
        `${SIGNAL_SELECT} WHERE s.Id > ? ORDER BY s.Id ASC`,
      ).all(this.lastId) as SignalJoinRow[]
      if (rows.length === 0) return
      this.lastId = rows[rows.length - 1]!.Id
      this.lastChangeMs = Date.now()
      const fresh = rows.map(toSignal)
      for (const cb of this.listeners) cb(fresh)
    } catch { /* transient lock; retry next tick */ }
  }

  close(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    this.db?.close()
    this.db = null
    this.listeners.clear()
  }
}
