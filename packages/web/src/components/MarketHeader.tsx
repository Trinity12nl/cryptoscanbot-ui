import { useEffect, useMemo, useRef, useState } from 'react'
import type { Barometer, BarometerGraph, MarketIndicators, PriceMap, SymbolRow, Tickers } from '@csb/shared'
import { fetchBarometerGraph } from '../lib/api'
import { formatPrice, formatCompact } from '../lib/format'
import { BarometerPanel } from './BarometerPanel'

/**
 * The scanner-header strip: four always-visible columns (Barometer, Market Indicators, Crypto Prices,
 * Tickers) matching the C# scanner, styled to fit this app. Fed by the SignalR broadcasts the bridge
 * now relays (barometer tips + graph, market indicators, prices) plus the symbols list for volume.
 *
 * Tickers counters are placeholders for now - the scanner does not broadcast them yet; the real
 * engine counters get wired in a small C# follow-up.
 */

const PRICE_BASES = ['BTC', 'ETH', 'XRP', 'SOL', 'ADA']

// Tickers column rows. The first three are live engine counters; Open positions stays a placeholder
// (trading is out of scope for this build).
const TICKER_ROWS: { label: string; value: (t: Tickers | null) => number | null }[] = [
  { label: 'Kline Ticker Count', value: (t) => t?.klineTickerCount ?? null },
  { label: 'Scanner analyze Count', value: (t) => t?.analyzeCount ?? null },
  { label: 'Scanner signal Count', value: (t) => t?.signalCount ?? null },
  { label: 'Open positions', value: () => null },
]

interface Props {
  barometers: Map<string, Barometer>
  indicators: MarketIndicators | null
  tickers: Tickers | null
  prices: PriceMap
  symbols: SymbolRow[]
}

function fmtIndicator(name: string, value: number): string {
  if (/fear/i.test(name)) return String(Math.round(value)) // Fear & Greed is a 0-100 index
  return formatCompact(value)
}

function directionClass(prev: number | undefined, current: number): string {
  if (prev == null || prev === current) return 'text-zinc-600 dark:text-zinc-300'
  return current > prev ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
}

function fearGreedClass(value: number): string {
  if (value >= 60) return 'text-emerald-600 dark:text-emerald-400'
  if (value <= 40) return 'text-red-500 dark:text-red-400'
  return 'text-zinc-600 dark:text-zinc-300'
}

const Divider = () => <div className="self-stretch w-px bg-zinc-200 dark:bg-zinc-800 shrink-0" />
const ColTitle = ({ children }: { children: string }) => (
  <span className="font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{children}</span>
)

export function MarketHeader({ barometers, indicators, tickers, prices, symbols }: Props) {
  const quotes = useMemo(() => [...barometers.keys()].sort(), [barometers])
  const [quote, setQuote] = useState('USDT')
  const [interval, setInterval] = useState('1h')
  const [graph, setGraph] = useState<BarometerGraph | null>(null)

  // Keep the quote valid: prefer USDT, else the first quote the engine reports a barometer for.
  const activeQuote = barometers.has(quote) ? quote : (quotes[0] ?? quote)
  const tip = barometers.get(activeQuote) ?? null

  // Pull the graph on quote/interval change and refresh it every 60s (points are per-minute).
  useEffect(() => {
    let alive = true
    const load = () => { void fetchBarometerGraph(activeQuote, interval).then((g) => { if (alive) setGraph(g) }) }
    load()
    const id = window.setInterval(load, 60_000)
    return () => { alive = false; window.clearInterval(id) }
  }, [activeQuote, interval])

  // Colour indicator values by their move since the previous broadcast (like the scanner's red/green).
  const prevIndicators = useRef<Map<string, number>>(new Map())
  const seenIndicators = useRef<MarketIndicators | null>(null)
  const prev = prevIndicators.current
  useEffect(() => {
    if (indicators && indicators !== seenIndicators.current) {
      prevIndicators.current = new Map(indicators.indicators.map((i) => [i.name, i.value]))
      seenIndicators.current = indicators
    }
  }, [indicators])

  const symbolVolume = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of symbols) if (s.volume != null) m.set(s.name, s.volume)
    return m
  }, [symbols])

  const priceRows = PRICE_BASES.map((base) => {
    const name = base + activeQuote
    return { base, name, price: prices[name] ?? null, volume: symbolVolume.get(name) ?? null }
  })

  return (
    <div className="flex shrink-0 items-start gap-5 overflow-x-auto border-b border-zinc-200 bg-white px-4 pb-2.5 pt-3.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
      <BarometerPanel
        quotes={quotes} quote={activeQuote} onQuote={setQuote}
        interval={interval} onInterval={setInterval} graph={graph} tip={tip}
      />

      <Divider />

      {/* Market Indicators */}
      <div className="flex shrink-0 flex-col gap-1">
        <ColTitle>Market Indicators</ColTitle>
        <div className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5">
          {(indicators?.indicators ?? []).map((ind) => (
            <div key={ind.name} className="contents">
              <span className="text-zinc-500 dark:text-zinc-400">{ind.name}</span>
              <span className={`text-right font-mono font-semibold ${
                /fear/i.test(ind.name) ? fearGreedClass(ind.value) : directionClass(prev.get(ind.name), ind.value)
              }`}>{fmtIndicator(ind.name, ind.value)}</span>
            </div>
          ))}
          {!indicators && <span className="text-zinc-400 dark:text-zinc-600">Loading...</span>}
        </div>
      </div>

      <Divider />

      {/* Crypto Prices */}
      <div className="flex shrink-0 flex-col gap-1">
        <ColTitle>Crypto Prices</ColTitle>
        <div className="grid grid-cols-[auto_auto_auto] gap-x-4 gap-y-0.5">
          {priceRows.map((r) => (
            <div key={r.name} className="contents">
              <span className="text-zinc-500 dark:text-zinc-400">{r.name}</span>
              <span className="text-right font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                {formatPrice(r.price)}
              </span>
              <span className="text-right font-mono text-zinc-500 dark:text-zinc-400">
                {r.volume != null ? formatCompact(r.volume) : '-'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Divider />

      {/* Tickers - live engine counters (Open positions stays '-': trading is out of scope). */}
      <div className="flex shrink-0 flex-col gap-1">
        <ColTitle>Tickers</ColTitle>
        <div className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5">
          {TICKER_ROWS.map(({ label, value }) => {
            const v = value(tickers)
            return (
              <div key={label} className="contents">
                <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
                <span className={`text-right font-mono ${v != null ? 'font-semibold text-zinc-800 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-600'}`}>
                  {v != null ? v.toLocaleString('en-US') : '-'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
