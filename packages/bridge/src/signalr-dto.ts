import type { Barometer, BarometerGraph, MarketIndicators, PriceMap, Tickers } from '@csb/shared'

/**
 * Translation of the C# SignalR hub's wire DTOs (PascalCase, JSON `PropertyNamingPolicy = null`) to
 * our UI-shaped camelCase types. Kept separate from signalr-source.ts so the client stays small and
 * the exact wire contract (matching CryptoScanner.Core/SignalR/*.cs) lives in one place.
 *
 * Dates arrive as ISO-8601 strings (System.Text.Json DateTime). We keep epoch ms.
 */

interface BarometerWire {
  Exchange: string
  Quote: string
  Barometer15m: number | null
  Barometer30m: number | null
  Barometer1h: number | null
  Barometer4h: number | null
  Barometer1d: number | null
  CalculatedAt: string
  Ready: boolean
  Progress: string | null
}

interface PricesWire {
  Exchange: string
  Date: string
  Prices: Record<string, number>
}

interface MarketIndicatorWire {
  Name: string
  Value: number
  Volume: number
}

interface MarketIndicatorsWire {
  Date: string
  Indicators: MarketIndicatorWire[]
}

interface BarometerPointWire {
  Date: string
  Value: number
}

interface TickersWire {
  Date: string
  KlineTickerCount: number
  AnalyzeCount: number
  SignalCount: number
}

interface BarometerGraphWire {
  Exchange: string
  Quote: string
  Interval: string
  Ready: boolean
  Progress: string | null
  Points: BarometerPointWire[]
}

/** Parse an ISO date string to epoch ms, or null when absent/unparseable. */
function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

export function parseBarometer(w: BarometerWire): Barometer {
  return {
    exchange: w.Exchange,
    quote: w.Quote,
    m15: w.Barometer15m,
    m30: w.Barometer30m,
    h1: w.Barometer1h,
    h4: w.Barometer4h,
    d1: w.Barometer1d,
    calculatedAtMs: toMs(w.CalculatedAt),
    ready: w.Ready,
    progress: w.Progress ?? '',
  }
}

export function parsePrices(w: PricesWire): PriceMap {
  // Already a symbolName -> price map; the C# side keys it exactly like our normalised names.
  return w.Prices ?? {}
}

export function parseMarketIndicators(w: MarketIndicatorsWire): MarketIndicators {
  return {
    dateMs: toMs(w.Date),
    indicators: (w.Indicators ?? []).map((i) => ({
      name: i.Name,
      value: i.Value,
      volume: i.Volume,
    })),
  }
}

export function parseTickers(w: TickersWire): Tickers {
  return {
    dateMs: toMs(w.Date),
    klineTickerCount: w.KlineTickerCount,
    analyzeCount: w.AnalyzeCount,
    signalCount: w.SignalCount,
  }
}

export function parseBarometerGraph(w: BarometerGraphWire): BarometerGraph {
  return {
    exchange: w.Exchange,
    quote: w.Quote,
    interval: w.Interval,
    ready: w.Ready,
    progress: w.Progress ?? '',
    points: (w.Points ?? []).map((p) => ({ tMs: toMs(p.Date) ?? 0, value: p.Value })),
  }
}
