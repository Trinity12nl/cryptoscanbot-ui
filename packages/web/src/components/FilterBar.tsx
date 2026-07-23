import { Info } from 'lucide-react'
import type { EngineSettings } from '@csb/shared'
import { MultiSelect, type SelectOption } from './MultiSelect'

export interface Filters {
  strategies: string[]
  intervals: string[]
  side: 'all' | 'long' | 'short'
}

export const DEFAULT_FILTERS: Filters = { strategies: [], intervals: [], side: 'all' }

const SIDES: ('all' | 'long' | 'short')[] = ['all', 'long', 'short']

export function FilterBar({
  filters, onChange, strategies, intervals, settings, onReset,
}: {
  filters: Filters
  onChange: (f: Filters) => void
  strategies: string[]
  intervals: string[]
  settings: EngineSettings | null
  /** Reset the filters to what the engine is currently scanning. */
  onReset: () => void
}) {
  const stratOpts: SelectOption[] = strategies.map((s) => ({ value: s, label: s }))
  const ivOpts: SelectOption[] = intervals.map((iv) => ({ value: iv, label: iv }))

  // Smart selects: options the engine has switched off are dimmed (still selectable so you can
  // browse dormant history). Only applied when we can read the engine's settings.
  const inactiveStrategies = settings
    ? new Set(strategies.filter((s) => !settings.enabledStrategies.includes(s)))
    : undefined
  const inactiveIntervals = settings && settings.enabledIntervals.length > 0
    ? new Set(intervals.filter((iv) => !settings.enabledIntervals.includes(iv)))
    : undefined
  const sideOff = (s: 'all' | 'long' | 'short'): boolean =>
    settings != null && ((s === 'long' && !settings.sides.long) || (s === 'short' && !settings.sides.short))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelect options={stratOpts} value={filters.strategies} inactive={inactiveStrategies}
        onChange={(strategies) => onChange({ ...filters, strategies })} placeholder="All strategies" />

      <MultiSelect options={ivOpts} value={filters.intervals} inactive={inactiveIntervals}
        onChange={(intervals) => onChange({ ...filters, intervals })} placeholder="All intervals" />

      <div className="flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
        {SIDES.map((s, i) => {
          const off = sideOff(s)
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...filters, side: s })}
              title={off ? 'Off in engine settings - not currently scanning' : undefined}
              className={`h-8 px-3 text-xs capitalize transition-colors ${
                filters.side === s
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : off
                    ? 'bg-white text-zinc-300 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-600 dark:hover:bg-zinc-700'
                    : 'bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
              } ${i > 0 ? 'border-l border-zinc-200 dark:border-zinc-700' : ''}`}
            >
              {s}
            </button>
          )
        })}
      </div>

      {/* Reset to what the engine is scanning - subtle text link with an info tooltip (ported from the old app). */}
      <div className="group relative flex items-center">
        <button
          type="button"
          onClick={onReset}
          disabled={!settings}
          className="flex h-8 items-center gap-1 px-3 text-xs text-zinc-500 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Reset
          <Info size={11} className="text-zinc-400 dark:text-zinc-500" />
        </button>
        <div className="pointer-events-none absolute left-1/2 top-full z-[200] mt-2 w-72 -translate-x-1/2 rounded-md bg-zinc-900 px-2.5 py-2 text-center text-xs leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-zinc-100 dark:text-zinc-900">
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-zinc-900 dark:border-b-zinc-100" />
          Resets the filters to what your scanner is currently scanning - its enabled strategies, intervals and sides.
        </div>
      </div>
    </div>
  )
}
