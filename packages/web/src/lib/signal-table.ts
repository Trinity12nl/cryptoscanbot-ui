import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnOrderState,
  type SortingState,
  type Table,
  type VisibilityState,
} from '@tanstack/react-table'
import { useEffect, useMemo, useState } from 'react'
import type { Signal } from '@csb/shared'
import { buildSignalColumns, DEFAULT_COLUMN_VISIBILITY } from '../components/signal-columns'

/**
 * The signal grid's TanStack table + its persisted column state (visibility + order), lifted into a
 * hook so it can be shared: the ColumnPicker lives up in the filter bar while the table renders the
 * grid below - both need the same table instance.
 */

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

/** Move `from` to sit where `to` is, preserving the rest of the order (used by header drag-reorder). */
export function moveColumn(order: string[], from: string, to: string): ColumnOrderState {
  const without = order.filter((id) => id !== from)
  const idx = without.indexOf(to)
  if (idx < 0) return order
  without.splice(idx, 0, from)
  return without
}

export function useSignalTable(data: Signal[]): Table<Signal> {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(loadColumnVisibility)
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(loadColumnOrder)

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

  return useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, columnOrder },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
}
