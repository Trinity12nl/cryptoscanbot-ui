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
  filters, onChange, strategies, intervals, settings,
}: {
  filters: Filters
  onChange: (f: Filters) => void
  strategies: string[]
  intervals: string[]
  settings: EngineSettings | null
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
    </div>
  )
}
