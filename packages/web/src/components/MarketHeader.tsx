import { useEffect, useMemo, useRef, useState } from 'react'
import type { Barometer, BarometerGraph, MarketIndicators, PriceMap, SymbolRow, Tickers } from '@csb/shared'
import { fetchBarometerGraph, fetchBarometerValues } from '../lib/api'
import { formatPrice, formatCompact, formatCount } from '../lib/format'
import { BarometerPanel } from './BarometerPanel'

/**
 * The scanner-header strip: four always-visible columns (Barometer, Market Indicators, Crypto Prices,
 * Tickers) matching the C# scanner, styled to fit this app. Fed by the SignalR broadcasts the bridge
 * now relays (barometer tips + graph, market indicators, prices) plus the symbols list for volume.
 *
 * Tickers counters are placeholders for now - the scanner does not broadcast them yet; the real
 * engine counters get wired in a small C# follow-up.
 */

// Crypto Prices shows the top N symbols of the active quote by 24h volume (dynamic, like the
// scanner intends), instead of a fixed base list.
const PRICE_COUNT = 5

// Market Indicators in the exact order the C# scanner shows them (DashBoardInformationView TvSymbols):
// Market Cap Total, US Dollar Index, S&P 500, BTC Dominance, Fear & Greed. The engine broadcasts them
// in an unstable order, so we sort by keyword; anything unrecognised falls to the end.
const INDICATOR_ORDER = ['market cap', 'dollar', 's&p', 'dominance', 'fear']
function indicatorRank(name: string): number {
  const n = name.toLowerCase()
  const i = INDICATOR_ORDER.findIndex((kw) => n.includes(kw))
  return i === -1 ? INDICATOR_ORDER.length : i
}

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
  /** Base coins to show under Crypto Prices, from the engine's `ShowSymbolInformation` config (same
   * source the scanner uses), in order. Each is paired with the active quote; non-existent pairs are
   * skipped. */
  priceBases: string[]
  /** Active quote coins from settings. The barometer dropdown offers these (unioned with any the
   * engine has pushed) so a web user can pick a quote the desktop app hasn't selected. */
  quoteOptions: string[]
}

function fmtIndicator(name: string, value: number): string {
  if (/fear/i.test(name)) return String(Math.round(value)) // Fear & Greed is a plain 0-100 index
  return formatCompact(value)
}

const DIR_UP = 'text-emerald-600 dark:text-emerald-400'
const DIR_DOWN = 'text-red-500 dark:text-red-400'
const DIR_NEUTRAL = 'text-zinc-600 dark:text-zinc-300'

/**
 * Persistent up/down colour per key, matching the scanner: the colour flips only when a value
 * actually moves and stays put on unchanged ticks (instead of snapping back to neutral - the market
 * indicators repeat the same value between many broadcasts). Kept in a ref so it survives re-renders;
 * calling it during render is idempotent for a given (key, value).
 */
function makeDirectionTracker(): (key: string, value: number) => string {
  const lastValue = new Map<string, number>()
  const lastClass = new Map<string, string>()
  return (key, value) => {
    const prev = lastValue.get(key)
    if (prev === undefined) { lastValue.set(key, value); return DIR_NEUTRAL }
    if (value !== prev) {
      lastClass.set(key, value > prev ? DIR_UP : DIR_DOWN)
      lastValue.set(key, value)
    }
    return lastClass.get(key) ?? DIR_NEUTRAL
  }
}

const Divider = () => <div className="self-stretch w-px bg-zinc-200 dark:bg-zinc-800 shrink-0" />
const ColTitle = ({ children }: { children: string }) => (
  <span className="font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{children}</span>
)

export function MarketHeader({ barometers, indicators, tickers, prices, symbols, priceBases, quoteOptions }: Props) {
  // Dropdown offers the active quote coins (from settings), so a web user can pick any quote the
  // desktop app hasn't selected. We deliberately do NOT union in the pushed barometer keys: that map
  // only ever grows (a quote pushed while active lingers after it's deactivated), which would leave
  // stale quotes in the list. The engine only pushes active quotes anyway, so settings is the truth.
  // Fall back to the pushed keys (or USDT) only until settings load, so the list is never empty.
  const quotes = useMemo(() => {
    if (quoteOptions.length) return [...quoteOptions].sort()
    const pushed = [...barometers.keys()]
    return pushed.length ? pushed.sort() : ['USDT']
  }, [quoteOptions, barometers])

  const [quote, setQuote] = useState('USDT')
  const [interval, setInterval] = useState('1h')
  const [graph, setGraph] = useState<BarometerGraph | null>(null)
  const [rpcTip, setRpcTip] = useState<Barometer | null>(null)

  // Honour the user's pick when it's a valid option, else prefer USDT, else the first available.
  const activeQuote = quotes.includes(quote) ? quote : (quotes.includes('USDT') ? 'USDT' : (quotes[0] ?? 'USDT'))

  // The desktop push only carries its own SelectedQuote. For that quote we use the pushed tip; for any
  // other quote - and on connect, before the first push - we pull the values via the point-3 RPC.
  const pushedTip = barometers.get(activeQuote) ?? null
  const tip = pushedTip ?? rpcTip

  // Pull the RPC values whenever the active quote has no pushed tip, polling at the push cadence so a
  // web-chosen quote stays fresh. Reset on every quote change so a stale reading never shows under a
  // new label; once a push covers the quote, pushedTip wins and we stop polling.
  const hasPush = pushedTip != null
  useEffect(() => {
    setRpcTip(null)
    if (hasPush) return
    let alive = true
    const load = () => { void fetchBarometerValues(activeQuote).then((b) => { if (alive) setRpcTip(b) }) }
    load()
    const id = window.setInterval(load, 60_000)
    return () => { alive = false; window.clearInterval(id) }
  }, [activeQuote, hasPush])

  // While the scanner is still loading candles the graph isn't Ready yet; the barometer TIP (pushed
  // over WS every ~2s) flips Ready long before the next graph pull would. So poll the graph fast while
  // not-ready and let Ready itself be an effect dependency: the moment the tip reports Ready, this
  // effect re-runs and pulls the finished graph immediately (instead of up to 60s later). Once ready,
  // the per-minute points only need a 60s refresh.
  const tipReady = tip?.ready ?? false
  useEffect(() => {
    let alive = true
    const load = () => { void fetchBarometerGraph(activeQuote, interval).then((g) => { if (alive) setGraph(g) }) }
    load()
    const id = window.setInterval(load, tipReady ? 60_000 : 5_000)
    return () => { alive = false; window.clearInterval(id) }
  }, [activeQuote, interval, tipReady])

  // Persistent green/red trackers (survive re-renders) for the indicator values and the crypto prices.
  const indicatorDir = useRef(makeDirectionTracker()).current
  const priceDir = useRef(makeDirectionTracker()).current

  // Show the indicators in the scanner's fixed order regardless of broadcast order.
  const sortedIndicators = useMemo(
    () => [...(indicators?.indicators ?? [])].sort((a, b) => indicatorRank(a.name) - indicatorRank(b.name)),
    [indicators],
  )

  // Crypto Prices = the engine's configured base coins (ShowSymbolInformation), each paired with the
  // active quote, in order - the same set the scanner shows. Pairs that don't exist on the exchange
  // (e.g. PAXGUSDT) are skipped; take the first few that do.
  const byName = useMemo(() => new Map(symbols.map((s) => [s.name, s])), [symbols])
  const topSymbols = useMemo(() => {
    const rows: SymbolRow[] = []
    for (const base of priceBases) {
      const s = byName.get(base + activeQuote)
      if (s) rows.push(s)
      if (rows.length >= PRICE_COUNT) break
    }
    return rows
  }, [priceBases, byName, activeQuote])

  const priceRows = topSymbols.map((s) => {
    const price = prices[s.name] ?? null
    return {
      name: s.name,
      price,
      volume: s.volume,
      cls: price == null ? DIR_NEUTRAL : priceDir(s.name, price),
    }
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
          {sortedIndicators.map((ind) => (
            <div key={ind.name} className="contents">
              <span className="text-zinc-500 dark:text-zinc-400">{ind.name}</span>
              <span className={`text-right font-mono font-semibold ${indicatorDir(ind.name, ind.value)}`}>
                {fmtIndicator(ind.name, ind.value)}
              </span>
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
              <span className={`text-right font-mono font-semibold ${r.cls}`}>
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
                  {v != null ? formatCount(v) : '-'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
