import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnOrderState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Signal } from '@csb/shared'
import { signalExpiryMs } from '@csb/shared'
import { buildSignalColumns, DEFAULT_COLUMN_VISIBILITY } from './signal-columns'
import { ColumnPicker } from './ColumnPicker'
import { buildChartUrl, getChartLinkProvider } from '../lib/chart-links'

const COLUMN_VISIBILITY_KEY = 'csb.signalColumns'
const COLUMN_ORDER_KEY = 'csb.signalColumnOrder'

function loadColumnVisibility(): VisibilityState {
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_KEY)
    if (!raw) return { ...DEFAULT_COLUMN_VISIBILITY }
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_COLUMN_VISIBILITY }
    return { ...DEFAULT_COLUMN_VISIBILITY, ...(parsed as VisibilityState) }
  } catch {
    return { ...DEFAULT_COLUMN_VISIBILITY }
  }
}

function loadColumnOrder(): ColumnOrderState {
  try {
    const raw = localStorage.getItem(COLUMN_ORDER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) return []
    return parsed as ColumnOrderState
  } catch {
    return []
  }
}

// Keep known ids in their saved position, append new columns at the end, drop removed ids.
function reconcileOrder(saved: ColumnOrderState, allIds: string[]): ColumnOrderState {
  const known = saved.filter((id) => allIds.includes(id))
  const missing = allIds.filter((id) => !known.includes(id))
  return [...known, ...missing]
}

function moveColumn(order: string[], from: string, to: string): ColumnOrderState {
  const without = order.filter((id) => id !== from)
  const idx = without.indexOf(to)
  if (idx < 0) return order
  without.splice(idx, 0, from)
  return without
}

// Sticky header: stays put while the table body scrolls. Needs a SOLID background (the row content
// scrolls underneath) and its own bottom border, since the header row can detach from the tbody.
const thCls = 'sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-2.5 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 whitespace-nowrap select-none'
const tdCls = 'px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 whitespace-nowrap'

function SortIcon({ dir }: { dir: false | 'asc' | 'desc' }) {
  if (dir === 'asc') return <ChevronUp size={11} className="ml-1 inline opacity-70" />
  if (dir === 'desc') return <ChevronDown size={11} className="ml-1 inline opacity-70" />
  return <ChevronsUpDown size={11} className="ml-1 inline opacity-40" />
}

export function SignalTable({ signals, newIds, expireCandles }: {
  signals: Signal[]
  newIds: ReadonlySet<number>
  /** Candles after which a signal is stale (from engine settings; 0 = never). Dims expired rows. */
  expireCandles: number
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(loadColumnVisibility)
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(loadColumnOrder)
  const dragColRef = useRef<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  useEffect(() => {
    try { localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(columnVisibility)) } catch { /* non-fatal */ }
  }, [columnVisibility])

  useEffect(() => {
    if (columnOrder.length === 0) return
    try { localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(columnOrder)) } catch { /* non-fatal */ }
  }, [columnOrder])

  const columns = useMemo(() => buildSignalColumns(), [])
  const allColumnIds = useMemo(() => columns.map((c) => c.id as string), [columns])

  useEffect(() => {
    setColumnOrder((prev) => {
      const next = reconcileOrder(prev, allColumnIds)
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next
    })
  }, [allColumnIds])

  const table = useReactTable({
    data: signals,
    columns,
    state: { sorting, columnVisibility, columnOrder },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-2">
      <div className="flex justify-end">
        <ColumnPicker table={table} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    draggable
                    onDragStart={(e) => { dragColRef.current = h.column.id; e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverCol !== h.column.id) setDragOverCol(h.column.id) }}
                    onDragLeave={() => setDragOverCol((c) => (c === h.column.id ? null : c))}
                    onDrop={(e) => {
                      e.preventDefault()
                      const from = dragColRef.current
                      if (from && from !== h.column.id) setColumnOrder((o) => moveColumn(o.length > 0 ? o : allColumnIds, from, h.column.id))
                      dragColRef.current = null
                      setDragOverCol(null)
                    }}
                    onDragEnd={() => { dragColRef.current = null; setDragOverCol(null) }}
                    className={`${thCls} cursor-move ${h.column.getCanSort() ? 'hover:text-zinc-900 dark:hover:text-zinc-100' : ''} ${dragOverCol === h.column.id ? 'border-l-2 border-l-emerald-500' : ''}`}
                    title="Drag to reorder - click to sort"
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getCanSort() && <SortIcon dir={h.column.getIsSorted()} />}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="px-3 py-16 text-center text-sm text-zinc-400 dark:text-zinc-500">
                  No signals match - clear filters, or wait for the engine to fire.
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((row) => {
              const s = row.original
              const isNew = newIds.has(s.id)
              const expiry = signalExpiryMs(s.openDateMs, s.interval, expireCandles)
              const expired = expiry != null && Date.now() > expiry
              return (
                <tr
                  key={row.id}
                  onClick={() => {
                    const url = buildChartUrl(getChartLinkProvider(), s.exchange, s.symbol, s.interval)
                    if (url) window.open(url, '_blank', 'noopener,noreferrer')
                  }}
                  title={expired ? 'Expired - older than the engine keeps signals' : 'Open chart'}
                  className={`cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${isNew ? 'signal-new' : ''} ${expired ? 'opacity-40' : ''}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={tdCls}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
