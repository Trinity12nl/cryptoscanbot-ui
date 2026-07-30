import { flexRender, type Table } from '@tanstack/react-table'
import { ChevronDown, ChevronUp, ChevronsUpDown, Loader2, Pencil } from 'lucide-react'
import { Fragment, useRef, useState } from 'react'
import type { Signal } from '@csb/shared'
import { signalExpiryMs } from '@csb/shared'
import { moveColumn } from '../lib/signal-table'
import { buildChartUrl, getChartLinkProvider } from '../lib/chart-links'

// Sticky header: stays put while the table body scrolls. Needs a SOLID background (the row content
// scrolls underneath) and its own bottom border, since the header row can detach from the tbody.
// Bottom line via box-shadow, not border-b: a sticky th's border disappears on scroll under
// border-collapse, but an inset shadow rides along with the cell.
const thCls = 'sticky top-0 z-10 bg-zinc-50 px-3 py-2.5 text-left text-xs font-medium text-zinc-500 shadow-[inset_0_-1px_0_rgb(228_228_231)] dark:bg-zinc-900 dark:text-zinc-400 dark:shadow-[inset_0_-1px_0_rgb(39_39_42)] whitespace-nowrap select-none'
const tdCls = 'px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 whitespace-nowrap'

/** Why the grid is empty - drives the placeholder text, so a first run doesn't read like a bug.
 *  'loading'  = the engine is still loading candles (it hasn't started scanning yet)
 *  'waiting'  = the engine is up but has not fired a signal yet (normal on a fresh database)
 *  'filtered' = signals exist, the current filters just exclude them all */
export type SignalEmptyState = 'loading' | 'waiting' | 'filtered'

// The placeholder shown in place of rows. Kept separate so the three states read clearly.
function EmptyRow({ state, progress, colSpan }: { state: SignalEmptyState; progress: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-16 text-center text-sm text-zinc-400 dark:text-zinc-500">
        {state === 'loading' ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            {progress
              ? `Loading candles... ${progress}`
              : "The engine is still loading candles - scanning starts when it's done."}
          </span>
        ) : state === 'waiting'
          ? "Waiting for the first signals - the engine is running but hasn't fired one yet."
          : 'No signals match - clear filters, or wait for the engine to fire.'}
      </td>
    </tr>
  )
}

function SortIcon({ dir }: { dir: false | 'asc' | 'desc' }) {
  if (dir === 'asc') return <ChevronUp size={11} className="ml-1 inline opacity-70" />
  if (dir === 'desc') return <ChevronDown size={11} className="ml-1 inline opacity-70" />
  return <ChevronsUpDown size={11} className="ml-1 inline opacity-40" />
}

// Compact "Ns ago" / "Nm ago" for the settings-changed marker (ported from the old app).
function formatTimeAgo(timestampMs: number): string {
  const s = Math.floor((Date.now() - timestampMs) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function SignalTable({ table, newIds, expireCandles, settingsChangedAt, hasMore, onLoadMore, emptyState, loadProgress }: {
  /** The shared signal table (created in App via useSignalTable, so the ColumnPicker can sit in the
   * filter bar). Its data is the visible signal rows. */
  table: Table<Signal>
  newIds: ReadonlySet<number>
  /** Candles after which a signal is stale (from engine settings; 0 = never). Dims expired rows. */
  expireCandles: number
  /** When the engine settings last changed - inserts a divider before signals that predate it. */
  settingsChangedAt: number | null
  /** More rows exist beyond the ones passed in (drives the "Load more" footer). */
  hasMore: boolean
  onLoadMore: () => void
  /** Why the grid is empty (only used when there are no rows) - see SignalEmptyState. */
  emptyState: SignalEmptyState
  /** The engine's live candle-load progress, e.g. "45 / 118 (JUPUSDT)"; "" when not loading. */
  loadProgress: string
}) {
  const dragColRef = useRef<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const sorting = table.getState().sorting
  const allColumnIds = table.getAllLeafColumns().map((c) => c.id)

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-2">
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
                      if (from && from !== h.column.id) table.setColumnOrder((o) => moveColumn(o.length > 0 ? o : allColumnIds, from, h.column.id))
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
              <EmptyRow state={emptyState} progress={loadProgress} colSpan={table.getVisibleLeafColumns().length} />
            )}
            {(() => {
              const rows = table.getRowModel().rows
              const colCount = table.getVisibleLeafColumns().length
              // Only show the divider in default (unsorted) order, where rows are newest-first.
              const showDivider = settingsChangedAt != null && sorting.length === 0
              let dividerInserted = false
              return rows.map((row) => {
                const s = row.original
                const isNew = newIds.has(s.id)
                const expiry = signalExpiryMs(s.openDateMs, s.interval, expireCandles)
                const expired = expiry != null && Date.now() > expiry
                const insertDivider = showDivider && !dividerInserted && (s.openDateMs ?? 0) < settingsChangedAt!
                if (insertDivider) dividerInserted = true
                return (
                  <Fragment key={row.id}>
                    {insertDivider && (
                      <tr>
                        <td colSpan={colCount} className="border-y border-amber-200 bg-amber-50 px-3 py-1.5 dark:border-amber-800/50 dark:bg-amber-900/20">
                          <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <Pencil size={12} />
                            Settings changed {formatTimeAgo(settingsChangedAt!)} - signals below used previous settings
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr
                      onClick={() => {
                        const url = buildChartUrl(getChartLinkProvider(), s.exchange, s.symbol, s.interval)
                        if (url) window.open(url, '_blank', 'noopener,noreferrer')
                      }}
                      title={expired ? 'Expired - older than the engine keeps signals' : 'Open chart'}
                      className={`cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/40 ${isNew ? 'signal-new' : ''} ${expired ? 'opacity-40' : ''}`}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className={tdCls}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                )
              })
            })()}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full rounded-lg border border-zinc-200 py-2.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          Load more
        </button>
      )}
    </div>
  )
}
