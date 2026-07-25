import Database from 'better-sqlite3'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  EngineInfo, ScannerDataSource, Signal, SignalBarometer, SignalTrend, TradeSide, TrendDir, SymbolRow,
} from '@csb/shared'
import { strategyName } from '@csb/shared'

const APP = 'CryptoScanBot'

/** Default oracle DB path per platform (where the C# engine writes on each OS). */
export function defaultDbPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP, `${APP}.db`)
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP, `${APP}.db`)
  }
  // linux / other: .NET SpecialFolder.ApplicationData -> ~/.config
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP, `${APP}.db`)
}

/** Options for locating the engine's data (matches the C# engine's `-f "datafolder"`). */
export interface DataLocation {
  /** Explicit path to the oracle DB file (highest precedence). */
  dbPath?: string
  /** Folder the engine writes to (`-f`); the DB is `<dataDir>/CryptoScanBot.db`. */
  dataDir?: string
}

/**
 * Resolve the oracle DB path. Precedence: explicit `dbPath` -> `dataDir`/CryptoScanBot.db ->
 * `CSB_DB_PATH` env -> `CSB_DATA_DIR` env/CryptoScanBot.db -> platform default. This is what lets the
 * UI point at an engine launched with `-f "datafolder"` instead of the standard OS path.
 */
export function resolveDbPath(opts: DataLocation = {}): string {
  if (opts.dbPath) return opts.dbPath
  if (opts.dataDir) return join(opts.dataDir, `${APP}.db`)
  if (process.env.CSB_DB_PATH) return process.env.CSB_DB_PATH
  if (process.env.CSB_DATA_DIR) return join(process.env.CSB_DATA_DIR, `${APP}.db`)
  return defaultDbPath()
}

/**
 * Given a folder the user might have picked, find the folder that actually contains the oracle DB
 * (`CryptoScanBot.db`), checking in order: the folder itself -> its immediate subfolders -> its
 * parent. Returns that folder, or null when no DB is found nearby.
 *
 * Pure lookup - it never changes anything. Its job is to power the "did you mean this folder?"
 * suggestion in the no-database banner, for the common trap where a user points the app one level
 * off: the engine writes the DB in e.g. `…/Futures` but also creates a same-looking `Binance Futures`
 * subfolder right next to it, so it's easy to pick the child (parent-check catches that) or the
 * grandparent (subfolder-check catches that). We only ever SUGGEST the result; the user still clicks.
 */
export function findOracleDbDir(dir: string): string | null {
  const hasDb = (d: string): boolean => {
    try { return existsSync(join(d, `${APP}.db`)) } catch { return false }
  }
  if (hasDb(dir)) return dir
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && hasDb(join(dir, entry.name))) return join(dir, entry.name)
    }
  } catch { /* dir unreadable/missing; fall through to the parent check */ }
  const parent = dirname(dir)
  if (parent && parent !== dir && hasDb(parent)) return parent
  return null
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
  BollingerBandsPercentage: string | null; Last24HoursChange: string | null
  LastXDaysEffective: string | null; Rsi: string | null; StochOscillator: string | null
  StochSignal: string | null; MacdHistogram: string | null; BarcodePercentage: string | null
  EventText: string | null; OpenDate: string | null
  Barometer15m: string | null; Barometer30m: string | null; Barometer1h: string | null
  Barometer4h: string | null; Barometer1d: string | null
  Trend15m: number | null; Trend30m: number | null; Trend1h: number | null
  Trend4h: number | null; Trend1d: number | null
}

/** C# CryptoTrendIndicator: 1 = Bullish (up), 2 = Bearish (down), 0/Unknown/null -> null. */
function trendDir(v: number | null): TrendDir | null {
  return v === 1 ? 'up' : v === 2 ? 'down' : null
}

function toBarometer(r: SignalJoinRow): SignalBarometer {
  return {
    m15: num(r.Barometer15m), m30: num(r.Barometer30m), h1: num(r.Barometer1h),
    h4: num(r.Barometer4h), d1: num(r.Barometer1d),
  }
}

function toTrend(r: SignalJoinRow): SignalTrend {
  return {
    m15: trendDir(r.Trend15m), m30: trendDir(r.Trend30m), h1: trendDir(r.Trend1h),
    h4: trendDir(r.Trend4h), d1: trendDir(r.Trend1d),
  }
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
    change24h: num(r.Last24HoursChange),
    effective: num(r.LastXDaysEffective),
    rsi: num(r.Rsi),
    stochOsc: num(r.StochOscillator),
    stochSig: num(r.StochSignal),
    macdHistogram: num(r.MacdHistogram),
    barcode: num(r.BarcodePercentage),
    eventText: r.EventText ?? '',
    openDateMs: dateMs(r.OpenDate),
    barometer: toBarometer(r),
    trend: toTrend(r),
  }
}

const SIGNAL_SELECT = `
  SELECT s.Id, ex.Name AS ExchangeName, sym.Name AS SymbolName, i.Name AS IntervalName,
         s.Strategy, s.Side, s.SignalPrice, s.SignalVolume,
         s.TrendPercentagePrimary, s.TrendPercentageSecondary, s.BollingerBandsPercentage,
         s.Last24HoursChange, s.LastXDaysEffective, s.Rsi, s.StochOscillator, s.StochSignal,
         s.MacdHistogram, s.BarcodePercentage,
         s.EventText, s.OpenDate,
         s.Barometer15m, s.Barometer30m, s.Barometer1h, s.Barometer4h, s.Barometer1d,
         s.Trend15m, s.Trend30m, s.Trend1h, s.Trend4h, s.Trend1d
  FROM Signal s
  LEFT JOIN Symbol sym ON sym.Id = s.SymbolId
  LEFT JOIN Exchange ex ON ex.Id = s.ExchangeId
  LEFT JOIN Interval i ON i.Id = s.IntervalId`

/**
 * Phase A data source: reads the C# engine's SQLite oracle read-only (WAL-aware, so it sees the
 * engine's committed writes live) and polls for newly-inserted signals. Zero C# changes.
 */
export class SqliteDataSource implements ScannerDataSource {
  private readonly dbPath: string
  private db: Database.Database | null = null
  private lastId = 0
  private lastChangeMs: number | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(s: Signal[]) => void>()

  constructor(opts: DataLocation = {}) {
    this.dbPath = resolveDbPath(opts)
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
    // Standalone (Phase A) liveness == the DB file exists; the Hybrid source overrides `connected`
    // with the live hub state but keeps `dbPresent` as this file-existence check.
    const dbPresent = existsSync(this.dbPath)
    const connected = dbPresent
    // Only look for a nearby DB when the expected one is missing - so the banner can offer the folder
    // the user probably meant (the "picked one level off" trap). Never re-points on its own.
    const suggestedDataDir = dbPresent ? null : findOracleDbDir(dirname(this.dbPath))
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
    return {
      exchange, dbPath: this.dbPath, connected, dbPresent, suggestedDataDir,
      lastChangeMs: this.lastChangeMs,
    }
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
    // The real exchange link is Symbol.ExchangeId -> Exchange.Name; the Symbol.ExchangeName column is
    // a C# quirk that actually holds the symbol's own name, so we join instead of trusting it. Filter
    // by the active exchange so the list matches what the engine is scanning (a symbol like BTCUSDT
    // exists once per exchange).
    const base = `
      SELECT s.Name, s.Base, s.Quote, ex.Name AS ExchangeName, s.Volume, s.Status
      FROM Symbol s LEFT JOIN Exchange ex ON ex.Id = s.ExchangeId`
    const rows = (opts.exchange
      ? db.prepare(`${base} WHERE ex.Name = ? ORDER BY s.Name`).all(opts.exchange)
      : db.prepare(`${base} ORDER BY s.Name`).all()) as Array<{
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

  /** Force an immediate poll for newly-inserted signals instead of waiting for the next interval
   * tick. Used by the SignalR trigger (Phase B) for near-instant push. No-op until polling has been
   * started by subscribeSignals(), so we never flood by emitting the whole backlog. */
  pollNow(): void {
    if (this.pollTimer) this.poll()
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
