import type { Table } from '@tanstack/react-table'
import { Columns3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Signal } from '@csb/shared'
import { DEFAULT_COLUMN_VISIBILITY } from './signal-columns'

// C#-style "Select your columns": a dropdown with a checkbox per column.
export function ColumnPicker({ table }: { table: Table<Signal> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
      >
        <Columns3 size={13} />
        Columns
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-96 w-48 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-1.5 shadow-lg">
          <div className="mb-1 flex gap-1 border-b border-zinc-100 dark:border-zinc-800 px-1 pb-1.5">
            <button type="button" onClick={() => table.toggleAllColumnsVisible(true)}
              className="flex-1 rounded px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">All</button>
            <button type="button" onClick={() => table.setColumnVisibility({ ...DEFAULT_COLUMN_VISIBILITY })}
              className="flex-1 rounded px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">Default</button>
            <button type="button" onClick={() => table.toggleAllColumnsVisible(false)}
              className="flex-1 rounded px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">None</button>
          </div>
          {table.getAllLeafColumns().map((column) => {
            const canHide = column.getCanHide()
            return (
              <label key={column.id}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 ${canHide ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800' : 'cursor-not-allowed opacity-60'}`}>
                <input type="checkbox" className="accent-emerald-500"
                  checked={column.getIsVisible()} disabled={!canHide}
                  onChange={column.getToggleVisibilityHandler()} />
                {column.columnDef.meta?.label ?? column.id}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
