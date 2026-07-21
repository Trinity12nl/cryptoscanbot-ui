import { useMemo, useState } from 'react'
import type { SymbolRow } from '@csb/shared'
import { fmtVol } from '../lib/format.ts'

export function SymbolsPanel({ symbols }: { symbols: SymbolRow[] }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase()
    const rows = needle ? symbols.filter((s) => s.name.toUpperCase().includes(needle)) : symbols
    return [...rows].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
  }, [symbols, q])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-edge bg-panel">
      <div className="border-b border-edge p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Symbols</span>
          <span className="font-mono text-xs text-muted">{filtered.length}</span>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter…"
          className="w-full rounded border border-edge bg-panel2 px-2 py-1 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.map((s) => (
          <div
            key={`${s.exchange}:${s.name}`}
            className="flex items-center justify-between px-2.5 py-1 text-sm hover:bg-panel2"
          >
            <span className="truncate">{s.name}</span>
            <span className="ml-2 shrink-0 font-mono text-xs text-muted">{fmtVol(s.volume)}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
