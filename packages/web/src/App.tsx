import { useEffect, useMemo, useRef, useState } from 'react'
import type { EngineInfo, EngineSettings, PriceMap, Signal, SymbolRow } from '@csb/shared'
import { INTERVAL_SEC } from '@csb/shared'
import { connectBridge, fetchInfo, fetchPrices, fetchSettings, fetchSignals, fetchSymbols } from './lib/api.ts'
import { PricesContext } from './context/PricesContext.tsx'
import { Header } from './components/Header.tsx'
import { FilterBar, DEFAULT_FILTERS, type Filters } from './components/FilterBar.tsx'
import { SignalTable } from './components/SignalTable.tsx'
import { SymbolsPanel } from './components/SymbolsPanel.tsx'
import { NoDataBanner } from './components/NoDataBanner.tsx'

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
function scannedFilters(settings: EngineSettings | null): Filters {
  if (!settings) return DEFAULT_FILTERS
  const { long, short } = settings.sides
  const side: Filters['side'] = long && short ? 'all' : long ? 'long' : short ? 'short' : 'all'
  return { strategies: settings.enabledStrategies, intervals: settings.enabledIntervals, side }
}

export function App() {
  const [info, setInfo] = useState<EngineInfo | null>(null)
  const [live, setLive] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [signals, setSignals] = useState<Signal[]>([])
  const [symbols, setSymbols] = useState<SymbolRow[]>([])
  const [prices, setPrices] = useState<PriceMap>({})
  const [settings, setSettings] = useState<EngineSettings | null>(null)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [error, setError] = useState<string | null>(null)
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(new Set())
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [settingsChangedAt, setSettingsChangedAt] = useState<number | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didInitFilters = useRef(false)
  const prevConfigSig = useRef<string | null>(null)

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
      if (ev.type === 'settings') {
        // Flag the banner only when the scan-relevant config actually changed (signature), not on
        // the engine's bookkeeping rewrites (which bump the file mtime) or a WS reconnect.
        const sig = ev.settings.configSignature
        if (prevConfigSig.current != null && sig !== prevConfigSig.current) {
          setSettingsChangedAt(ev.settings.lastChangedMs)
          // Keep the filter in sync with what the engine now scans, so a newly enabled strategy
          // (e.g. Jump) is ticked and its signals actually show - otherwise the banner appears but
          // the rows stay hidden behind the old filter.
          setFilters(scannedFilters(ev.settings))
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

  // Default the filters to what the engine is scanning, once, when settings first arrive.
  useEffect(() => {
    if (didInitFilters.current || !settings) return
    didInitFilters.current = true
    setFilters(scannedFilters(settings))
  }, [settings])

  // Changing a filter starts the list from the top again.
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [filters])

  // Filter options: the full catalog, plus anything the engine reports enabled or that a signal
  // uses. FilterBar dims the ones the engine is not scanning.
  const strategies = useMemo(
    () => unionCatalog(STRATEGY_CATALOG, settings?.enabledStrategies ?? [], signals.map((s) => s.strategy)),
    [signals, settings],
  )
  const intervals = useMemo(
    () => unionCatalog(INTERVAL_CATALOG, settings?.enabledIntervals ?? [], signals.map((s) => s.interval)),
    [signals, settings],
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
    return signals.filter((s) => (s.openDateMs ?? 0) >= ms).length
  }, [signals])

  const filtered = useMemo(() => signals.filter((s) => {
    if (filters.side !== 'all' && s.side !== filters.side) return false
    if (filters.strategies.length > 0 && !filters.strategies.includes(s.strategy)) return false
    if (filters.intervals.length > 0 && !filters.intervals.includes(s.interval)) return false
    return true
  }), [signals, filters])

  // Paginated view: show PAGE_SIZE rows, "Load more" reveals the next page.
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  // The bridge is reading a DB with no data (usual cause: an engine started with `-f` writing
  // elsewhere). Guarded by `loaded` so it doesn't flash before the first fetch resolves.
  const emptyDb = loaded && (info?.dbPresent ?? false) && symbols.length === 0 && signals.length === 0

  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Header info={info} live={live} shown={visible.length} today={todayCount} />
      <NoDataBanner info={info} empty={emptyDb} />
      {error && (
        <div className="bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
          {error} - is the bridge running and the C# engine writing its DB?
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <SymbolsPanel symbols={symbols} activeQuoteMins={activeQuoteMins} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
            <FilterBar filters={filters} onChange={setFilters} strategies={strategies} intervals={intervals} settings={settings} onReset={() => setFilters(scannedFilters(settings))} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            <PricesContext.Provider value={prices}>
              <SignalTable signals={visible} newIds={newIds} expireCandles={settings?.removeSignalAfterCandles ?? 0} settingsChangedAt={settingsChangedAt} hasMore={filtered.length > visible.length} onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)} />
            </PricesContext.Provider>
          </div>
        </main>
      </div>
    </div>
  )
}
