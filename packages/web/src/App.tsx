import { useEffect, useMemo, useRef, useState } from 'react'
import type { EngineInfo, EngineSettings, PriceMap, Signal, SymbolRow } from '@csb/shared'
import { connectBridge, fetchInfo, fetchPrices, fetchSettings, fetchSignals, fetchSymbols } from './lib/api.ts'
import { PricesContext } from './context/PricesContext.tsx'
import { Header } from './components/Header.tsx'
import { FilterBar, DEFAULT_FILTERS, type Filters } from './components/FilterBar.tsx'
import { SignalTable } from './components/SignalTable.tsx'
import { SymbolsPanel } from './components/SymbolsPanel.tsx'

export function App() {
  const [info, setInfo] = useState<EngineInfo | null>(null)
  const [live, setLive] = useState(false)
  const [signals, setSignals] = useState<Signal[]>([])
  const [symbols, setSymbols] = useState<SymbolRow[]>([])
  const [prices, setPrices] = useState<PriceMap>({})
  const [settings, setSettings] = useState<EngineSettings | null>(null)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [error, setError] = useState<string | null>(null)
  const [newIds, setNewIds] = useState<ReadonlySet<number>>(new Set())
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetchInfo(), fetchSignals(1000), fetchSymbols(), fetchPrices(), fetchSettings()])
      .then(([i, s, sy, p, st]) => { if (alive) { setInfo(i); setSignals(s); setSymbols(sy); setPrices(p); setSettings(st) } })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'))

    const off = connectBridge((ev) => {
      if (ev.type === 'info') setInfo(ev.info)
      if (ev.type === 'prices') setPrices(ev.prices)
      if (ev.type === 'settings') setSettings(ev.settings)
      if (ev.type === 'signals') {
        setSignals((prev) => {
          const byId = new Map(prev.map((s) => [s.id, s]))
          for (const s of ev.signals) byId.set(s.id, s)
          return [...byId.values()].sort((a, b) => b.id - a.id)
        })
        setNewIds(new Set(ev.signals.map((s) => s.id)))
        if (clearTimer.current) clearTimeout(clearTimer.current)
        clearTimer.current = setTimeout(() => setNewIds(new Set()), 2000)
      }
    }, setLive)

    return () => { alive = false; off(); if (clearTimer.current) clearTimeout(clearTimer.current) }
  }, [])

  // Available filter options, derived from the loaded signals.
  const strategies = useMemo(() => [...new Set(signals.map((s) => s.strategy))].sort(), [signals])
  const intervals = useMemo(() => [...new Set(signals.map((s) => s.interval))].sort(), [signals])

  const filtered = useMemo(() => signals.filter((s) => {
    if (filters.side !== 'all' && s.side !== filters.side) return false
    if (filters.strategies.length > 0 && !filters.strategies.includes(s.strategy)) return false
    if (filters.intervals.length > 0 && !filters.intervals.includes(s.interval)) return false
    return true
  }), [signals, filters])

  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Header info={info} live={live} signalCount={signals.length} />
      {error && (
        <div className="bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
          {error} - is the bridge running and the C# engine writing its DB?
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <SymbolsPanel symbols={symbols} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
            <FilterBar filters={filters} onChange={setFilters} strategies={strategies} intervals={intervals} settings={settings} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            <PricesContext.Provider value={prices}>
              <SignalTable signals={filtered} newIds={newIds} expireCandles={settings?.removeSignalAfterCandles ?? 0} />
            </PricesContext.Provider>
          </div>
        </main>
      </div>
    </div>
  )
}
