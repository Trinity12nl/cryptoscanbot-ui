import { useMemo, useState } from 'react'
import type { SymbolRow } from '@csb/shared'
import { formatCompact } from '../lib/format'

export function SymbolsPanel({ symbols }: { symbols: SymbolRow[] }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase()
    const rows = needle ? symbols.filter((s) => s.name.toUpperCase().includes(needle)) : symbols
    return [...rows].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
  }, [symbols, q])

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 p-2.5 dark:border-zinc-800">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Symbols</span>
          <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">{filtered.length}</span>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter…"
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.map((s) => (
          <div key={`${s.exchange}:${s.name}`}
            className="flex items-center justify-between px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/50">
            <span className="truncate">{s.name}</span>
            <span className="ml-2 shrink-0 text-xs text-zinc-400 dark:text-zinc-500">{formatCompact(s.volume)}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
