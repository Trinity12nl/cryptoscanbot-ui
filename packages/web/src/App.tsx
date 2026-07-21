import { useEffect, useRef, useState } from 'react'
import type { EngineInfo, Signal, SymbolRow } from '@csb/shared'
import { connectBridge, fetchInfo, fetchSignals, fetchSymbols } from './lib/api.ts'
import { Header } from './components/Header.tsx'
import { SignalsTable } from './components/SignalsTable.tsx'
import { SymbolsPanel } from './components/SymbolsPanel.tsx'

export function App() {
  const [info, setInfo] = useState<EngineInfo | null>(null)
  const [live, setLive] = useState(false)
  const [signals, setSignals] = useState<Signal[]>([])
  const [symbols, setSymbols] = useState<SymbolRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const flashIds = useRef<Set<number>>(new Set())

  useEffect(() => {
    let alive = true
    Promise.all([fetchInfo(), fetchSignals(500), fetchSymbols()])
      .then(([i, s, sy]) => {
        if (!alive) return
        setInfo(i); setSignals(s); setSymbols(sy)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'))

    const off = connectBridge((ev) => {
      if (ev.type === 'info') setInfo(ev.info)
      if (ev.type === 'signals') {
        for (const s of ev.signals) flashIds.current.add(s.id)
        setSignals((prev) => {
          const byId = new Map(prev.map((s) => [s.id, s]))
          for (const s of ev.signals) byId.set(s.id, s)
          return [...byId.values()].sort((a, b) => b.id - a.id)
        })
        setTimeout(() => { flashIds.current.clear() }, 2000)
      }
    }, setLive)

    return () => { alive = false; off() }
  }, [])

  return (
    <div className="flex h-full flex-col bg-[#0d1017]">
      <Header info={info} live={live} signalCount={signals.length} />
      {error && (
        <div className="bg-short/20 px-4 py-2 text-sm text-short">
          {error} - is the bridge running and the C# engine writing its DB?
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <SymbolsPanel symbols={symbols} />
        <main className="min-w-0 flex-1 overflow-hidden">
          <SignalsTable signals={signals} flashIds={flashIds.current} />
        </main>
      </div>
    </div>
  )
}
