import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { SymbolRow } from '@csb/shared'
import { formatCompact } from '../lib/format'

const COLLAPSE_KEY = 'csb.symbolsCollapsed'

// Sticky header cell. Bottom line via box-shadow (a border-b disappears on scroll under
// border-collapse). Font matches SignalTable.
const thCls = 'sticky top-0 z-10 cursor-pointer select-none bg-white px-2.5 py-2 text-xs font-medium text-zinc-500 shadow-[inset_0_-1px_0_rgb(228_228_231)] hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-400 dark:shadow-[inset_0_-1px_0_rgb(39_39_42)] dark:hover:text-zinc-100 whitespace-nowrap'

type SortKey = 'name' | 'volume'

export function SymbolsPanel({ symbols, activeQuoteMins }: {
  symbols: SymbolRow[]
  /** Active quote coins -> their min volume. When set, only these quotes are listed and symbols at
   * or above the threshold are highlighted. */
  activeQuoteMins: Record<string, number> | null
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })

  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v)
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* non-fatal */ }
  }

  const toggleSort = (key: SortKey) => {
    setSort((s) => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'volume' ? 'desc' : 'asc' })
  }

  const sortIcon = (key: SortKey) => {
    if (sort.key !== key) return <ChevronsUpDown size={11} className="ml-1 inline opacity-40" />
    return sort.dir === 'asc'
      ? <ChevronUp size={11} className="ml-1 inline opacity-70" />
      : <ChevronDown size={11} className="ml-1 inline opacity-70" />
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase()
    // Dedupe by name: the DB can hold the same symbol under more than one exchange (e.g. after an
    // exchange switch), which otherwise yields duplicate React keys and breaks list reconciliation.
    const seen = new Set<string>()
    const rows: SymbolRow[] = []
    for (const s of symbols) {
      if (activeQuoteMins && !(s.quote in activeQuoteMins)) continue
      if (!s.volume || s.volume <= 0) continue // hide dead / zero-volume symbols
      if (needle && !s.name.toUpperCase().includes(needle)) continue
      if (seen.has(s.name)) continue
      seen.add(s.name)
      rows.push(s)
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return rows.sort((a, b) => sort.key === 'name'
      ? a.name.localeCompare(b.name) * dir
      : ((a.volume ?? 0) - (b.volume ?? 0)) * dir)
  }, [symbols, q, sort, activeQuoteMins])

  if (collapsed) {
    return (
      <aside className="flex w-9 shrink-0 flex-col items-center border-r border-zinc-200 bg-white py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => setCollapsedPersist(false)}
          title="Show symbols"
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <PanelLeftOpen size={16} />
        </button>
        <span className="mt-3 font-mono text-[10px] text-zinc-400 [writing-mode:vertical-rl] dark:text-zinc-500">
          {symbols.length} symbols
        </span>
      </aside>
    )
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 p-2.5 dark:border-zinc-800">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Symbols</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">{filtered.length}</span>
            <button
              onClick={() => setCollapsedPersist(true)}
              title="Hide symbols"
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <PanelLeftClose size={15} />
            </button>
          </div>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQ('') }}
          placeholder="Filter…"
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th onClick={() => toggleSort('name')} className={`${thCls} text-left`} title="Sort by symbol">Symbol {sortIcon('name')}</th>
              <th onClick={() => toggleSort('volume')} className={`${thCls} w-20 text-right`} title="Sort by volume">Volume {sortIcon('volume')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const min = activeQuoteMins?.[s.quote]
              const aboveMin = min != null && (s.volume ?? 0) >= min
              return (
                <tr key={`${s.exchange}:${s.name}`} className="hover:bg-zinc-100 dark:hover:bg-zinc-800/50">
                  <td className="px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-100">
                    <div className="truncate">{s.name}</div>
                  </td>
                  <td
                    className={`px-2.5 py-1.5 text-right font-mono text-xs ${aboveMin ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'}`}
                  >
                    {formatCompact(s.volume)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </aside>
  )
}
