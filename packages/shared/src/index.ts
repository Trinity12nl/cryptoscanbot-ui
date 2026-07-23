/**
 * The data contract between the UI and whatever is feeding it. This is THE seam that keeps
 * Phase A (read the C# engine's SQLite oracle) and Phase B (talk to a headless C# host) swappable:
 * the UI only ever depends on ScannerDataSource + these DTOs, never on where the data comes from.
 *
 * DTOs are UI-shaped (numbers already parsed, side/strategy already named) - the mapping from the
 * C# schema (TEXT-encoded decimals, integer enums) lives in whatever implements ScannerDataSource.
 */

export type TradeSide = 'long' | 'short'

/** C# CryptoSignalStrategy enum (avalonia branch) -> display name. */
export const STRATEGY_NAMES: Record<number, string> = {
  0: 'Jump', 1: 'Sbm1', 2: 'Sbm2', 3: 'Sbm3', 6: 'Stobb', 7: 'StobbMulti',
  10: 'StoRsi', 11: 'StoRsiMulti', 25: 'Nwe', 28: 'Baba', 29: 'AtrRb', 30: 'Bre',
  31: 'Trend', 42: 'Bbma', 43: 'BbmaOmni', 52: 'StochDir', 53: 'BbRsiEngulfing',
  54: 'IchimokuKumoBreakout', 60: 'ChochPrimary', 61: 'ChochPrimaryPullback',
  62: 'ChochSecondary', 63: 'ChochSecondaryPullback', 1000: 'DominantLevel',
  1001: 'DominantLevelNear', 1003: 'FairValueGap', 1004: 'OrderBlock',
}

export function strategyName(id: number): string {
  return STRATEGY_NAMES[id] ?? `#${id}`
}

/** Interval name -> duration in seconds (for candle open/close identity). */
export const INTERVAL_SEC: Record<string, number> = {
  '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900,
  '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600,
  '8h': 28800, '12h': 43200, '1d': 86400, '1w': 604800,
}

/** One fired signal (from the C# Signal table). */
export interface Signal {
  id: number
  exchange: string
  symbol: string
  interval: string
  strategyId: number
  strategy: string
  side: TradeSide
  price: number | null
  volume: number | null
  /** Dow-theory market trend % (C# TrendPercentagePrimary). */
  trendPrimary: number | null
  /** BOS/CHoCH market trend % (C# TrendPercentageSecondary) - the two often disagree. */
  trendSecondary: number | null
  /** Bollinger %B at signal time. */
  bbPercentage: number | null
  /** 24h price change % at signal time. */
  change24h: number | null
  /** "Effective" change % over the settings window (C# LastXDaysEffective). */
  effective: number | null
  rsi: number | null
  stochOsc: number | null
  stochSig: number | null
  macdHistogram: number | null
  /** "Barcode" / flatness metric. */
  barcode: number | null
  eventText: string
  /** Signal open time, epoch ms UTC. */
  openDateMs: number | null
}

/** true when the two market-trend readings disagree in sign and both are meaningful.
 * A "goodie" the Avalonia UI can't show - it only surfaces one trend. */
export function isTrendDivergent(s: Pick<Signal, 'trendPrimary' | 'trendSecondary'>): boolean {
  const a = s.trendPrimary, b = s.trendSecondary
  if (a == null || b == null) return false
  return Math.sign(a) !== Math.sign(b) && Math.abs(a) >= 40 && Math.abs(b) >= 40
}

/** One tradable symbol (from the C# Symbol table). Note: Symbol has no live price column
 * (only min/max/tick); the C# "Distance" is computed at runtime, so it's not in the oracle. */
export interface SymbolRow {
  exchange: string
  name: string
  base: string
  quote: string
  volume: number | null
  status: number | null
}

/** What exchange the engine is currently scanning (from the oracle), e.g. "Bybit Spot". */
export interface EngineInfo {
  exchange: string | null
  /** Path to the oracle DB the bridge is reading. */
  dbPath: string
  /** true when the DB file exists and is readable. */
  connected: boolean
  /** Last time the bridge saw the DB change, epoch ms. */
  lastChangeMs: number | null
}

/**
 * The one interface the UI talks to. Phase A: SqliteDataSource. Phase B: HttpDataSource.
 * Note: barometer + live market-indicators are engine-in-memory (NOT in SQLite), so they arrive
 * only in Phase B via the C# host - hence not on this Phase-A-capable contract yet.
 */
export interface ScannerDataSource {
  info(): Promise<EngineInfo>
  getSignals(opts?: { limit?: number; sinceMs?: number }): Promise<Signal[]>
  getSymbols(opts?: { exchange?: string }): Promise<SymbolRow[]>
  /** Fires cb whenever new signals appear. Returns an unsubscribe fn. */
  subscribeSignals(cb: (signals: Signal[]) => void): () => void
  close(): void
}

/** Live last-price per normalised symbol name (e.g. "ONDOUSDT" -> 0.398). Sourced from a public
 * exchange ticker feed in Phase A; will move to the headless C# engine in Phase B (same shape). */
export type PriceMap = Record<string, number>

/**
 * What the engine is CONFIGURED to scan, for the active exchange - read (never written) from the C#
 * engine's settings JSON. Drives the "smart" filters: options that are off here are shown dimmed so
 * you can see what is actually running vs. dormant. Phase B: served by the headless host, same shape.
 */
export interface EngineSettings {
  /** The exchange these settings apply to (General.ActivateExchangeName). */
  activeExchange: string | null
  /** Strategy display names (see STRATEGY_NAMES) that are switched ON in the engine. */
  enabledStrategies: string[]
  /** Interval names (e.g. "1m","5m") the engine is configured to scan. */
  enabledIntervals: string[]
  /** Which trade sides the engine emits. */
  sides: { long: boolean; short: boolean }
  /** Configured quote coins; `active` = the engine actually fetches/scans it. */
  quoteCoins: { name: string; minVolume: number; active: boolean }[]
  /** Candles after a signal's open before it is considered stale/expired (0 = never expire). */
  removeSignalAfterCandles: number
}

/** When a signal goes stale, epoch ms - or null if freshness is off or the interval is unknown. */
export function signalExpiryMs(
  openDateMs: number | null, interval: string, removeAfterCandles: number,
): number | null {
  if (openDateMs == null || removeAfterCandles <= 0) return null
  const sec = INTERVAL_SEC[interval]
  if (!sec) return null
  return openDateMs + removeAfterCandles * sec * 1000
}

/** Live price change % of a signal vs its entry, coloured by whether the move favours the position
 * (a drop is a gain for a short). Returns null when we have no live price yet. */
export function signalChangePct(signalPrice: number | null, livePrice: number | undefined): number | null {
  if (signalPrice == null || signalPrice <= 0 || livePrice == null) return null
  return 100 * (livePrice / signalPrice - 1)
}

/** WebSocket message envelope the bridge pushes to the UI. */
export type BridgeEvent =
  | { type: 'signals'; signals: Signal[] }
  | { type: 'info'; info: EngineInfo }
  | { type: 'prices'; prices: PriceMap }
  | { type: 'settings'; settings: EngineSettings }
