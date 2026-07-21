// Side + trend display helpers. Strategy names come from @csb/shared (avalonia ids),
// so they are NOT duplicated here - the old app's STRATEGY_LABEL used stale 2.0.x ids.
import type { TradeSide } from '@csb/shared'

export const SIDE_BADGE_CLASS: Record<TradeSide, string> = {
  long: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium',
  short: 'bg-red-500/10 text-red-700 dark:text-red-400 font-medium',
}

// Colour a signed percentage: green positive, red negative, muted zero/null.
export function pctClass(v: number | null | undefined): string {
  if (v == null || v === 0) return 'text-zinc-400 dark:text-zinc-500'
  return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
}

// Market-trend %: only strong readings get colour (matches the gate thresholds ±60),
// mild trend stays neutral so the eye catches the decisive ones.
export function trendClass(v: number | null | undefined): string {
  if (v == null) return 'text-zinc-400 dark:text-zinc-500'
  if (v >= 60) return 'text-emerald-600 dark:text-emerald-400'
  if (v <= -60) return 'text-red-600 dark:text-red-400'
  return 'text-zinc-600 dark:text-zinc-300'
}
