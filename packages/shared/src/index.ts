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
  10: 'StoRsi', 11: 'StoRsiMulti', 25: 'Nwe', 26: 'NweNp', 27: 'NweBb', 28: 'Vbs',
  29: 'AtrRb', 30: 'Dbr', 31: 'Trend', 42: 'Bbma', 43: 'BbmaOmni', 52: 'StochDir',
  53: 'BbRsiEngulfing', 54: 'IchimokuKumoBreakout', 55: 'BbSqueeze',
  60: 'ChochPrimary', 61: 'ChochPrimaryPullback',
  62: 'ChochSecondary', 63: 'ChochSecondaryPullback', 1000: 'DominantLevel',
  1001: 'DominantLevelNear', 1003: 'FairValueGap', 1004: 'OrderBlock',
  1006: 'OrderBlockRejection',
}

export function strategyName(id: number): string {
  return STRATEGY_NAMES[id] ?? `#${id}`
}

// Normalise a strategy string to letters+digits only, so the engine's dotted settings keys
// (e.g. "bbma.omni", "stobb.multi") compare equal to our display names ("BbmaOmni", "StobbMulti").
const normStrategy = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// normalised display name -> enum id (covers every key that is just the punctuation-stripped name).
const STRATEGY_ID_BY_NORM_NAME = new Map<string, number>(
  Object.entries(STRATEGY_NAMES).map(([id, name]) => [normStrategy(name), Number(id)]),
)

// The engine settings-file keys whose form is NOT the punctuation-stripped display name. Ported
// from the avalonia StrategyRegistration list (CryptoScanner.Analyzers/*/*Plugin.cs). Keys here are
// already normalised.
const STRATEGY_ID_BY_ALIAS = new Map<string, number>([
  ['dlz', 1000], ['dlznear', 1001], ['fvg', 1003], ['smc', 1004], ['smcrejection', 1006],
])

/** Map an engine settings-file strategy key (e.g. "bbma.omni", "dlz") to its enum id, or null. */
export function strategyIdFromSettingsKey(key: string): number | null {
  const k = normStrategy(key)
  return STRATEGY_ID_BY_ALIAS.get(k) ?? STRATEGY_ID_BY_NORM_NAME.get(k) ?? null
}

/** Map an engine settings-file strategy key to our display name, or null if unknown. */
export function strategyNameFromSettingsKey(key: string): string | null {
  const id = strategyIdFromSettingsKey(key)
  return id == null ? null : strategyName(id)
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
  /** Signal open time, epoch ms UTC (C# Signal.OpenDate). */
  openDateMs: number | null
  /** Signal candle close time, epoch ms UTC (C# Signal.CloseDate). NOTE this is the trigger candle's
   * close, which for OrderBlock is ~1 minute after open even on a 1h signal (it analyses the 1h block
   * but fires on the 1m candle) - so always display this, never open + interval. */
  closeDateMs: number | null
  /** Per-timeframe barometer reading at signal time (C# Signal.Barometer15m..1d). Each may be null. */
  barometer?: SignalBarometer | null
  /** Per-timeframe market-trend at signal time (C# Signal.Trend15m..1d: up/down, Unknown -> null). */
  trend?: SignalTrend | null
}

/** Simple market direction (C# CryptoTrendIndicator: Bullish -> up, Bearish -> down, Unknown -> null). */
export type TrendDir = 'up' | 'down'

/** Barometer readings per timeframe at signal time (from the oracle Signal table). */
export interface SignalBarometer {
  m15: number | null; m30: number | null; h1: number | null; h4: number | null; d1: number | null
}

/** Market-trend direction per timeframe at signal time (from the oracle Signal table). */
export interface SignalTrend {
  m15: TrendDir | null; m30: TrendDir | null; h1: TrendDir | null; h4: TrendDir | null; d1: TrendDir | null
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
  /** true when the engine is LIVE: a running SignalR hub connection (Phase B), or - with no hub -
   * the oracle DB file exists (Phase A fallback). Drives the online/offline dot. */
  connected: boolean
  /** true when the oracle DB file exists, independent of engine liveness. Drives the "no scanner
   * database found" banner, so quitting the engine shows offline but does NOT claim the DB is gone. */
  dbPresent: boolean
  /** When the DB is absent at `dbPath` but a `CryptoScanBot.db` was found in a nearby folder (an
   * immediate subfolder or the parent - the classic "picked one level off" case), this is that
   * folder. The banner offers it as a one-click fix; null when nothing suitable is nearby. The bridge
   * only ever SUGGESTS this - it never silently re-points. */
  suggestedDataDir?: string | null
  /** true when the bridge is configured to use the engine's SignalR hub (Phase B live link). This is
   * the OUR-side switch; it does not imply the hub is actually reachable. */
  signalrEnabled?: boolean
  /** true when the SignalR hub connection is live right now (only meaningful when signalrEnabled). */
  signalrConnected?: boolean
  /** The engine's OWN `General.SignalREnabled` read from its settings JSON, or null if unknown/unread.
   * Lets the UI say whether the scanner side is on (the other half of the live link). */
  engineSignalrEnabled?: boolean | null
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
  /** Optional: fires when engine INFO (not signals) changes out-of-band - e.g. the SignalR hub
   * connects/disconnects - so the server can push a fresh EngineInfo immediately instead of waiting
   * for its periodic poll. Sources without live liveness (Phase A) can omit it. Returns unsubscribe. */
  onInfoChange?(cb: () => void): () => void

  // --- Phase B live market data (SignalR hub). All optional: Phase A (SQLite only) omits them, and
  // the bridge simply falls back to its Phase-A behaviour (ccxt ticker for prices, no barometer/
  // indicators). The subscribe* methods fire on every live broadcast; the get* methods return the
  // last-known value so the bridge can replay a snapshot to each newly-connected UI client. ---

  /** Fires on every per-quote barometer tip. Returns an unsubscribe fn. */
  subscribeBarometer?(cb: (b: Barometer) => void): () => void
  /** Last-known barometer tip per quote (for snapshot-on-connect). */
  getBarometers?(): Barometer[]
  /** Fires on every live price snapshot from the hub. Returns an unsubscribe fn. */
  subscribePrices?(cb: (p: PriceMap) => void): () => void
  /** Last-known hub price snapshot, or null if the hub has not delivered one yet. */
  getSignalrPrices?(): PriceMap | null
  /** Fires on every market-indicators broadcast. Returns an unsubscribe fn. */
  subscribeMarketIndicators?(cb: (m: MarketIndicators) => void): () => void
  /** Last-known market indicators, or null if none delivered yet. */
  getMarketIndicators?(): MarketIndicators | null
  /** Fires on every engine-counters (Tickers) broadcast. Returns an unsubscribe fn. */
  subscribeTickers?(cb: (t: Tickers) => void): () => void
  /** Last-known engine counters, or null if none delivered yet. */
  getTickers?(): Tickers | null
  /** Pull the ~7h barometer graph for a quote+interval from the engine. Rejects if the hub is down. */
  getBarometerGraph?(quote: string, interval: string): Promise<BarometerGraph>
  /** Pull the current 1h/4h/1d barometer values for a quote (point-3 RPC). Lets a web user read a
   * quote the desktop app hasn't selected, instead of waiting on the single-quote push. Rejects if
   * the hub is down. */
  getBarometerValues?(quote: string): Promise<Barometer>

  // --- API keys (Telegram / Altrady). Phase B only; drive the engine's own credential + bot code
  // via SignalR. Secrets are write-only: reads return masked "has*" flags, never the values. ---
  /** Masked Telegram settings (has-token/has-chat-id + toggles). Rejects if the hub is down. */
  getTelegramSettings?(): Promise<TelegramSettings>
  /** Update Telegram settings + (re)start the bot. Blank token/chatId = keep existing. Returns masked. */
  applyTelegramSettings?(body: TelegramSettingsUpdate): Promise<TelegramSettings>
  /** Send a Telegram test message via the running bot. Resolves false if not configured. */
  sendTelegramTest?(): Promise<boolean>
  /** Masked Altrady settings (has-key/has-secret). Rejects if the hub is down. */
  getAltradySettings?(): Promise<AltradySettings>
  /** Update Altrady credentials. Blank key/secret = keep existing. Returns masked. */
  applyAltradySettings?(body: AltradySettingsUpdate): Promise<AltradySettings>

  /** Write value-level settings back to the engine and apply them live. The engine fences off exchange
   * + quote-fetch changes (destructive); returns the persisted settings. Rejects if the hub is down. */
  applySettings?(raw: RawSettings): Promise<RawSettings>

  close(): void
}

/** Masked Telegram settings from the engine - the token/chat id themselves are never sent. */
export interface TelegramSettings {
  hasToken: boolean
  hasChatId: boolean
  emojiInTrend: boolean
  sendSignalsToTelegram: boolean
}

/** Telegram update from the client. Blank/omitted token or chatId means "keep the stored one". */
export interface TelegramSettingsUpdate {
  token?: string
  chatId?: string
  emojiInTrend: boolean
  sendSignalsToTelegram: boolean
}

/** Masked Altrady settings from the engine - the key/secret themselves are never sent. */
export interface AltradySettings {
  hasKey: boolean
  hasSecret: boolean
}

/** Altrady update from the client. Blank/omitted key or secret means "keep the stored one". */
export interface AltradySettingsUpdate {
  key?: string
  secret?: string
}

/** Live last-price per normalised symbol name (e.g. "ONDOUSDT" -> 0.398). Sourced from a public
 * exchange ticker feed in Phase A; moves to the headless C# engine's SignalR hub in Phase B (same
 * shape). When the hub is live the bridge prefers its prices and stands the ccxt ticker down. */
export type PriceMap = Record<string, number>

/**
 * Live per-quote barometer tip from the engine (SignalR `ReceiveDashboardUpdate`, ~1/min). Each
 * timeframe reading is the current barometer % or null while still loading. Phase B only.
 */
export interface Barometer {
  exchange: string
  quote: string
  m15: number | null; m30: number | null; h1: number | null; h4: number | null; d1: number | null
  /** When the engine computed it, epoch ms UTC (null if unparseable). */
  calculatedAtMs: number | null
  /** false while the engine is still loading candles - the UI shows a pulsating skeleton, never a
   * half-filled graph. Flips true once the engine reaches Running. */
  ready: boolean
  /** Human progress string while loading, e.g. "25 / 25 (XRPUSDT)"; "" once ready. */
  progress: string
}

/** One point of the 7h barometer graph. */
export interface BarometerPoint {
  /** Point time, epoch ms UTC. */
  tMs: number
  value: number
}

/** The ~7h barometer graph for one quote+interval, pulled on demand from the engine
 * (SignalR `GetBarometerGraph`). Points are per-minute, oldest first. */
export interface BarometerGraph {
  exchange: string
  quote: string
  interval: string
  ready: boolean
  progress: string
  points: BarometerPoint[]
}

/** One market indicator (SignalR `ReceiveDashboardUpdate`): a TradingView value or Fear & Greed. */
export interface MarketIndicator {
  name: string
  value: number
  /** 0 when the indicator carries no volume (e.g. Fear & Greed index). */
  volume: number
}

/** The 5 market indicators broadcast together (~1/min): Market Cap Total, US Dollar Index, S&P 500,
 * BTC Dominance, Fear and Greed index. Phase B only. */
export interface MarketIndicators {
  /** Broadcast time, epoch ms UTC (null if unparseable). */
  dateMs: number | null
  indicators: MarketIndicator[]
}

/** Live engine counters for the scanner header's "Tickers" column (SignalR `ReceiveDashboardUpdate`,
 * ~1/min). Phase B only. (Open positions are omitted - trading is out of scope.) */
export interface Tickers {
  /** Broadcast time, epoch ms UTC (null if unparseable). */
  dateMs: number | null
  /** Kline ticks received from the exchange stream. */
  klineTickerCount: number
  /** Symbol analyses the scanner has run this session. */
  analyzeCount: number
  /** Signals created this session. */
  signalCount: number
}

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
  /** Interval names (e.g. "1m","5m") the engine is configured to scan (Signal.Long/Short.Interval). */
  enabledIntervals: string[]
  /** The intervals signals can actually appear on = enabledIntervals UNION each enabled ZONE
   * strategy's own interval list (SMC/OrderBlock, FVG, DLZ analyse higher timeframes - e.g. OrderBlock
   * scans 1h even when only 1m/2m/3m are scanned). Use THIS for the interval filter default/reset and
   * the "not scanning" dimming, so those higher-TF signals aren't hidden. */
  scannedIntervals: string[]
  /** Which trade sides the engine emits. */
  sides: { long: boolean; short: boolean }
  /** Configured quote coins; `active` = the engine actually fetches/scans it. */
  quoteCoins: { name: string; minVolume: number; active: boolean }[]
  /** Base coins the engine is configured to show in the header's Crypto Prices (General
   * `ShowSymbolInformation`), in order, e.g. ["BTC","ETH","XRP","SOL","ADA"]. */
  showSymbolInformation: string[]
  /** Candles after a signal's open before it is considered stale/expired (0 = never expire). */
  removeSignalAfterCandles: number
  /** Settings file last-modified time (epoch ms). Note: the engine rewrites this file for its own
   * bookkeeping too, so mtime alone is NOT a reliable "user changed settings" signal. */
  lastChangedMs: number
  /** Stable hash of only the scan-relevant config (strategies, intervals, sides, quotes, exchange,
   * expiry). Changes only on a real config change - use THIS to flag "settings changed". */
  configSignature: string
}

/**
 * The engine's settings JSON (`CryptoScanBot-settings.json`) parsed VERBATIM - the whole PascalCase
 * object as the C# `SettingsBasic` writes it, no projection. This is the contract the settings editor
 * works on: it renders the fields it knows and passes everything else (incl. the Trading block) back
 * untouched on write, so we never rebuild the full model in TS. `EngineSettings` above is the small
 * derived view that drives the filters; this is the raw source of truth for the settings page.
 */
export type RawSettings = Record<string, unknown>

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

/** WebSocket message envelope the bridge pushes to the UI. The barometer graph is a REST pull
 * (`GET /api/barometer-graph`), not a push event, since the UI requests it per quote+interval. */
export type BridgeEvent =
  | { type: 'signals'; signals: Signal[] }
  | { type: 'info'; info: EngineInfo }
  | { type: 'prices'; prices: PriceMap }
  | { type: 'settings'; settings: EngineSettings }
  | { type: 'settingsRaw'; settingsRaw: RawSettings }
  | { type: 'barometer'; barometer: Barometer }
  | { type: 'marketIndicators'; indicators: MarketIndicators }
  | { type: 'tickers'; tickers: Tickers }
