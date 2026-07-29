import { useEffect, useMemo, useRef, useState } from 'react'
import type { Barometer, EngineInfo, EngineSettings, MarketIndicators, PriceMap, Signal, SymbolRow, Tickers } from '@csb/shared'
import { INTERVAL_SEC } from '@csb/shared'
import { connectBridge, fetchInfo, fetchPrices, fetchSettings, fetchSignals, fetchSymbols } from './lib/api.ts'
import { PricesContext } from './context/PricesContext.tsx'
import { Header } from './components/Header.tsx'
import { MarketHeader } from './components/MarketHeader.tsx'
import { FilterBar, DEFAULT_FILTERS, type Filters } from './components/FilterBar.tsx'
import { SignalTable } from './components/SignalTable.tsx'
import { ColumnPicker } from './components/ColumnPicker.tsx'
import { SymbolsPanel } from './components/SymbolsPanel.tsx'
import { NoDataBanner } from './components/NoDataBanner.tsx'
import { useSignalTable } from './lib/signal-table.ts'

// Full known catalogs so the filters always show every strategy/timeframe - the ones the engine
// is not scanning appear dimmed as "not scanning" (like the previous app version), instead of only
// listing whatever happened to fire. Anything the engine reports or a signal uses but that is not
// listed here is appended, so nothing is ever hidden.
const STRATEGY_CATALOG = [
  'Jump', 'Sbm1', 'Sbm2', 'Sbm3', 'Stobb', 'StobbMulti', 'StoRsi', 'StoRsiMulti',
  'Nwe', 'BbRsiEngulfing', 'IchimokuKumoBreakout', 'DominantLevel', 'DominantLevelNear', 'FairValueGap',
]
const INTERVAL_CATALOG = Object.keys(INTERVAL_SEC)

function unionCatalog(catalog: string[], ...extras: string[][]): string[] {
  const list = [...catalog]
  for (const arr of extras) for (const v of arr) if (v && !list.includes(v)) list.push(v)
  return list
}

const PAGE_SIZE = 100

// The "scanning" filter set = what the engine is actually scanning right now. This is the default
// on load and what the Reset button returns to (so the scanned strategies/timeframes show ticked).
// intervals uses settings.scannedIntervals (NOT the raw scan intervals): the SMC/zone strategies
// (smc/dlz/fvg) analyse higher timeframes and emit e.g. 1h signals even when only 1m/2m/3m are
// scanned, and the bridge unions those zone intervals in so they show ticked (and aren't filtered out).
function scannedFilters(settings: EngineSettings | null): Filters {
  if (!settings) return DEFAULT_FILTERS
  const { long, short } = settings.sides
  const side: Filters['side'] = long && short ? 'all' : long ? 'long' : short ? 'short' : 'all'
  return { strategies: settings.enabledStrategies, intervals: settings.scannedIntervals, side }
}

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x))

// Track the scanner's active set across a settings change while preserving the user's manual tweaks
// (ported from the old app's reconcileWithScanner). Relative to the previous scanned set (`prev`), the
// current selection carries two manual diffs: extras (added on top) and removals (deselected). Re-apply
// both to the new scanned set (`next`): selection = (next - removals) + extras. So enabling a timeframe
// in settings adds it, disabling one removes it, and a manually-added extra stays. An empty ([] = "all")
// dimension is left as-is. Only the array dims are reconciled; `side` keeps the user's choice.
function reconcileFilters(current: Filters, prev: Filters, next: Filters): Filters {
  const dims = ['strategies', 'intervals'] as const
  let changed = false
  const merged: Filters = { ...current }
  for (const dim of dims) {
    if (current[dim].length === 0 || next[dim].length === 0) continue
    const extras = current[dim].filter((v) => !prev[dim].includes(v))
    const removals = prev[dim].filter((v) => !current[dim].includes(v))
    const reconciled = [
      ...next[dim].filter((v) => !removals.includes(v)),
      ...extras.filter((v) => !next[dim].includes(v)),
    ]
    if (!sameSet(reconciled, current[dim])) { merged[dim] = reconciled; changed = true }
  }
  return changed ? merged : current
}

export function App() {
  const [info, setInfo] = useState<EngineInfo | null>(null)
  const [live, setLive] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [signals, setSignals] = useState<Signal[]>([])
  const [symbols, setSymbols] = useState<SymbolRow[]>([])
  const [prices, setPrices] = useState<PriceMap>({})
  const [barometers, setBarometers] = useState<Map<string, Barometer>>(new Map())
  const [indicators, setIndicators] = useState<MarketIndicators | null>(null)
  const [tickers, setTickers] = useState<Tickers | null>(null)
  const [settings, setSettings] = useState<EngineSettings | null>(null)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [error, setError] = useState<string | null>(null)
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(new Set())
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [settingsChangedAt, setSettingsChangedAt] = useState<number | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didInitFilters = useRef(false)
  const prevConfigSig = useRef<string | null>(null)
  // The scanned set as of the last config change, so we can reconcile the user's selection forward
  // (add newly-scanned, drop newly-unscanned) instead of clobbering it. Seeded on first default.
  const prevScanned = useRef<Filters | null>(null)
  const didInitExchange = useRef(false)
  const everHadData = useRef(false)

  useEffect(() => {
    let alive = true
    // Load each piece independently (allSettled) so one transient failure - e.g. /api/prices or
    // /api/settings 500'ing during the engine's startup-sync write burst - can't blank the whole
    // screen. Signals is the history that matters most, so retry it a few times before giving up;
    // info/prices/settings also stream over the WebSocket, so a missed initial fetch self-heals.
    const loadSignals = async (attempt = 0): Promise<void> => {
      try {
        const s = await fetchSignals(1000)
        if (alive) { setSignals(s); setError(null) }
      } catch (e: unknown) {
        if (!alive) return
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000))
          return loadSignals(attempt + 1)
        }
        setError(e instanceof Error ? e.message : 'load failed')
      }
    }
    Promise.allSettled([
      fetchInfo().then((i) => { if (alive) setInfo(i) }),
      loadSignals(),
      fetchPrices().then((p) => { if (alive) setPrices(p) }),
      fetchSettings().then((st) => { if (alive && st) { setSettings(st); prevConfigSig.current = st.configSignature } }),
    ]).finally(() => { if (alive) setLoaded(true) })

    const off = connectBridge((ev) => {
      if (ev.type === 'info') setInfo(ev.info)
      if (ev.type === 'prices') setPrices(ev.prices)
      if (ev.type === 'barometer') setBarometers((prev) => new Map(prev).set(ev.barometer.quote, ev.barometer))
      if (ev.type === 'marketIndicators') setIndicators(ev.indicators)
      if (ev.type === 'tickers') setTickers(ev.tickers)
      if (ev.type === 'settings') {
        // Flag the banner only when the scan-relevant config actually changed (signature), not on
        // the engine's bookkeeping rewrites (which bump the file mtime) or a WS reconnect.
        const sig = ev.settings.configSignature
        if (prevConfigSig.current != null && sig !== prevConfigSig.current) {
          setSettingsChangedAt(ev.settings.lastChangedMs)
          // Keep the filter in sync with what the engine now scans (a newly enabled strategy/timeframe
          // gets ticked so its signals show), WITHOUT clobbering the user's manual selection: reconcile
          // forward from the previous scanned set instead of overwriting.
          const next = scannedFilters(ev.settings)
          const prev = prevScanned.current
          setFilters((f) => (prev ? reconcileFilters(f, prev, next) : next))
          prevScanned.current = next
        }
        prevConfigSig.current = sig
        setSettings(ev.settings)
      }
      if (ev.type === 'signals') {
        setSignals((prev) => {
          const byId = new Map(prev.map((s) => [s.id, s]))
          for (const s of ev.signals) byId.set(s.id, s)
          return [...byId.values()].sort((a, b) => b.id - a.id)
        })
        setNewIds(new Set(ev.signals.map((s) => s.id)))
        if (clearTimer.current) clearTimeout(clearTimer.current)
        clearTimer.current = setTimeout(() => setNewIds(new Set()), 5000)
      }
    }, setLive)

    return () => { alive = false; off(); if (clearTimer.current) clearTimeout(clearTimer.current) }
  }, [])

  // Load the symbol list for the ACTIVE exchange, and reload it when the engine switches exchange
  // (info.exchange updates live via the bridge). Without the filter we'd show a cross-exchange union
  // (a symbol exists once per exchange), which doesn't match what the scanner is actually running.
  // Also refresh every 60s: right after a switch the engine backfills volumes gradually, so the
  // filtered count climbs over time - polling lets it self-correct without a manual reload.
  useEffect(() => {
    let alive = true
    // silent = background refresh: keep the last good list on failure and don't raise the banner.
    // The engine churns its DB on restart/backfill and briefly 500s reads, which isn't worth
    // alarming over. Only the initial load / exchange switch surfaces a hard error.
    const load = (silent: boolean) => {
      fetchSymbols(info?.exchange ?? undefined)
        .then((sy) => {
          if (!alive) return
          setSymbols(sy)
          setError((prev) => (prev && prev.startsWith('symbols') ? null : prev)) // clear stale symbols error
        })
        .catch((e: unknown) => {
          if (!alive || silent) return
          setError(e instanceof Error ? e.message : 'symbols load failed')
        })
    }
    load(false)
    const id = setInterval(() => load(true), 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [info?.exchange])

  // When the engine switches exchange it wipes its Signal table (a signal belongs to one exchange), so
  // re-fetch and REPLACE the list to drop the old exchange's rows from memory and load the new set.
  // Skip the first known exchange (the initial load already fetched). The display is filtered by
  // active exchange (activeSignals) so stale rows also vanish instantly during the switch.
  useEffect(() => {
    if (info?.exchange == null) return
    if (!didInitExchange.current) { didInitExchange.current = true; return }
    let alive = true
    fetchSignals(1000).then((s) => { if (alive) setSignals(s) }).catch(() => { /* poll/WS self-heals */ })
    return () => { alive = false }
  }, [info?.exchange])

  // Latch "we've seen real data this session" - used to suppress the empty-DB misconfig banner during
  // a normal exchange switch (which briefly empties symbols+signals). Never resets short of a reload.
  useEffect(() => {
    if (symbols.length > 0 || signals.length > 0) everHadData.current = true
  }, [symbols.length, signals.length])

  // Default the filters to what the engine is scanning, once, when settings first arrive.
  useEffect(() => {
    if (didInitFilters.current || !settings) return
    didInitFilters.current = true
    const initial = scannedFilters(settings)
    prevScanned.current = initial
    setFilters(initial)
  }, [settings])

  // Changing a filter starts the list from the top again.
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [filters])

  // Only signals for the ACTIVE exchange. The scanner wipes its Signal table on an exchange switch, so
  // rows from the previous exchange are no longer valid - filtering by info.exchange makes them vanish
  // instantly (before the refetch below lands) instead of lingering in memory. Falls back to the full
  // set while the exchange is still unknown (initial load).
  const activeSignals = useMemo(
    () => (info?.exchange ? signals.filter((s) => s.exchange === info.exchange) : signals),
    [signals, info?.exchange],
  )

  // Filter options: the full catalog, plus anything the engine reports enabled or that a signal
  // uses. FilterBar dims the ones the engine is not scanning.
  const strategies = useMemo(
    () => unionCatalog(STRATEGY_CATALOG, settings?.enabledStrategies ?? [], activeSignals.map((s) => s.strategy)),
    [activeSignals, settings],
  )
  const intervals = useMemo(
    () => unionCatalog(INTERVAL_CATALOG, settings?.enabledIntervals ?? [], activeSignals.map((s) => s.interval)),
    [activeSignals, settings],
  )

  // Active quote coins (FetchCandles = true) mapped to their min volume - trims the symbols list and
  // lets it highlight symbols above the configured threshold.
  const activeQuoteMins = useMemo(() => {
    const on = (settings?.quoteCoins ?? []).filter((qc) => qc.active)
    return on.length > 0 ? Object.fromEntries(on.map((qc) => [qc.name, qc.minVolume])) : null
  }, [settings])

  // "today" = signals whose open time is on or after local midnight (computed from the loaded set).
  const todayCount = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const ms = start.getTime()
    return activeSignals.filter((s) => (s.openDateMs ?? 0) >= ms).length
  }, [activeSignals])

  const filtered = useMemo(() => activeSignals.filter((s) => {
    if (filters.side !== 'all' && s.side !== filters.side) return false
    if (filters.strategies.length > 0 && !filters.strategies.includes(s.strategy)) return false
    if (filters.intervals.length > 0 && !filters.intervals.includes(s.interval)) return false
    return true
  }), [activeSignals, filters])

  // Paginated view: show PAGE_SIZE rows, "Load more" reveals the next page.
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  // The signal grid's table lives here (not in SignalTable) so the ColumnPicker can sit in the filter
  // bar row while the grid renders below - both share this one instance.
  const table = useSignalTable(visible)

  // The bridge is reading a DB with no data (usual cause: an engine started with `-f` writing
  // elsewhere). Guarded by `loaded` so it doesn't flash before the first fetch resolves, and by
  // `everHadData` so a normal exchange switch - which transiently empties symbols+signals for a
  // minute while the engine backfills the new exchange - doesn't trip the misconfig banner. Once
  // we've seen real data this session, later emptiness is a switch/backfill, not a wrong folder.
  const emptyDb = loaded && (info?.dbPresent ?? false) && symbols.length === 0
    && activeSignals.length === 0 && !everHadData.current

  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Header info={info} live={live} shown={visible.length} today={todayCount} />
      {info?.signalrConnected && (
        <MarketHeader barometers={barometers} indicators={indicators} tickers={tickers} prices={prices} symbols={symbols} priceBases={settings?.showSymbolInformation ?? []} />
      )}
      <NoDataBanner info={info} empty={emptyDb} />
      {error && (
        <div className="bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
          {error} - is the bridge running and the C# engine writing its DB?
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <SymbolsPanel symbols={symbols} activeQuoteMins={activeQuoteMins} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
            <FilterBar filters={filters} onChange={setFilters} strategies={strategies} intervals={intervals} settings={settings} onReset={() => setFilters(scannedFilters(settings))} />
            <div className="ml-auto">
              <ColumnPicker table={table} />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            <PricesContext.Provider value={prices}>
              <SignalTable table={table} newIds={newIds} expireCandles={settings?.removeSignalAfterCandles ?? 0} settingsChangedAt={settingsChangedAt} hasMore={filtered.length > visible.length} onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)} />
            </PricesContext.Provider>
          </div>
        </main>
      </div>
    </div>
  )
}
