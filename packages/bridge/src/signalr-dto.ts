import type { Barometer, BarometerGraph, MarketIndicators, Tickers } from '@csb/shared'

/**
 * Translation of the C# engine's SignalR dashboard DTOs (avalonia `CryptoScanner.Core/SignalR/*.cs`,
 * PascalCase since `PayloadSerializerOptions.PropertyNamingPolicy = null`) into our UI-shaped
 * camelCase types. Kept separate from signalr-source.ts so the client stays small and the exact wire
 * contract lives in one place.
 *
 * The engine pushes ONE combined `ReceiveDashboardUpdate(DashboardUpdateDto)` (~1/min, and only while
 * `ApplicationStatus == Running`) plus answers a `GetBarometerGraph(quote, interval)` RPC. This is
 * Marius' official dashboard API (avalonia `0adb969f`); it replaces our interim four `Receive*`
 * broadcasts.
 *
 * Dates arrive as ISO-8601 strings (System.Text.Json DateTime); we keep epoch ms.
 *
 * NOTE on prices: the engine's `SymbolPrices` only covers `Settings.ShowSymbolInformation` (a handful
 * of reference symbols for the info bar), NOT every scanned symbol. Our signals-table Change column
 * needs the full map, so we deliberately do NOT map these into the price seam - the ccxt ticker stays
 * the price source (see signalr-source.ts / server.ts). SymbolPrices is therefore left unmapped.
 */

/** One barometer graph point (BarometerPointDto): `{ Time, Value }`. */
interface BarometerPointWire {
  Time: string
  Value: number
}

/** Current barometer summary (BarometerValuesDto): 1h/4h/1d only - no 15m/30m. `Ready`/`Progress` are
 * present on newer engine builds (candle-load state); optional so we still parse older builds.
 * Exported because the `GetBarometerValues(quote)` RPC returns this same shape on demand. */
export interface BarometerValuesWire {
  Quote: string
  Barometer1h: number
  Barometer4h: number
  Barometer1d: number
  BarometerTime: string
  Ready?: boolean
  Progress?: string | null
}

/** One market indicator (MarketIndicatorDto): a TradingView value or Fear & Greed. Price/Volume null
 * when the source has no reading yet. */
interface MarketIndicatorWire {
  Type: string
  Symbol: string
  Name: string
  Price: number | null
  Volume: number | null
}

/** Ticker/scanner counters (TickerStatsDto). `ScannerPositionCount` is intentionally ignored -
 * trading (open positions) is out of scope for our UI. */
interface TickerStatsWire {
  KlineTickerCount: number
  ScannerExecuteCount: number
  ScannerSignalCount: number
  ScannerPositionCount: string
}

/** The once-a-minute combined push (DashboardUpdateDto). */
export interface DashboardUpdateWire {
  LatestBarometerPoint: BarometerPointWire | null
  BarometerValues: BarometerValuesWire | null
  MarketIndicators: MarketIndicatorWire[] | null
  /** Engine info-bar symbol prices - present on the wire but intentionally unmapped (see file header). */
  SymbolPrices: unknown
  TickerStats: TickerStatsWire | null
}

/** The graph RPC result (BarometerGraphDto): `{ Quote, Interval, Points }`. No Exchange. `Ready`/
 * `Progress` are present on newer engine builds; optional so we still parse older builds. */
export interface BarometerGraphWire {
  Quote: string
  Interval: string
  Points: BarometerPointWire[]
  Ready?: boolean
  Progress?: string | null
}

/** Parse an ISO date string to epoch ms, or null when absent/unparseable. */
function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * The pieces we fan out from one dashboard push. Each is null when the engine omitted that section
 * (e.g. no active exchange yet). Prices are absent by design (the ccxt ticker owns them).
 */
export interface DashboardParts {
  barometer: Barometer | null
  marketIndicators: MarketIndicators | null
  tickers: Tickers | null
}

export function parseDashboardUpdate(w: DashboardUpdateWire): DashboardParts {
  return {
    barometer: parseBarometerValues(w.BarometerValues, w.LatestBarometerPoint),
    marketIndicators: parseMarketIndicators(w.MarketIndicators),
    tickers: parseTickerStats(w.TickerStats),
  }
}

/** BarometerValuesDto -> Barometer. 15m/30m are absent (null). `ready`/`progress` come from the engine's
 * candle-load state when present; older builds omit them, so we fall back to `ready=true` (the push
 * only fires once Running there anyway) and `progress=''`. `calculatedAtMs` comes from the latest graph
 * point's Time when present - `BarometerTime` is only an "HH:mm" display string, not a full timestamp. */
export function parseBarometerValues(
  bv: BarometerValuesWire | null, latest: BarometerPointWire | null,
): Barometer | null {
  if (!bv) return null
  return {
    exchange: '',
    quote: bv.Quote,
    m15: null,
    m30: null,
    h1: bv.Barometer1h,
    h4: bv.Barometer4h,
    d1: bv.Barometer1d,
    calculatedAtMs: toMs(latest?.Time),
    ready: bv.Ready ?? true,
    progress: bv.Progress ?? '',
  }
}

function parseMarketIndicators(list: MarketIndicatorWire[] | null): MarketIndicators | null {
  if (!list) return null
  return {
    dateMs: null,
    indicators: list.map((i) => ({
      name: i.Name,
      value: i.Price ?? 0,
      volume: i.Volume ?? 0,
    })),
  }
}

function parseTickerStats(t: TickerStatsWire | null): Tickers | null {
  if (!t) return null
  return {
    dateMs: null,
    klineTickerCount: t.KlineTickerCount,
    analyzeCount: t.ScannerExecuteCount,
    signalCount: t.ScannerSignalCount,
  }
}

export function parseBarometerGraph(w: BarometerGraphWire): BarometerGraph {
  return {
    exchange: '',
    quote: w.Quote,
    interval: w.Interval,
    ready: w.Ready ?? true,
    progress: w.Progress ?? '',
    points: (w.Points ?? []).map((p) => ({ tMs: toMs(p.Time) ?? 0, value: p.Value })),
  }
}
