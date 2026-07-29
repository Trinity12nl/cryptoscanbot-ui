// European notation everywhere: '.' as the thousands separator and ',' as the decimal separator
// (Dutch locale). Dates/times keep their own ISO-ish helpers below.
const LOCALE = 'nl-NL'

/** Fixed-decimal European format, e.g. nlFixed(1917.39, 4) -> "1.917,3900". */
function nlFixed(n: number, decimals: number): string {
  return n.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function formatPrice(n: number | null | undefined): string {
  if (n == null) return '-'
  const abs = Math.abs(n)
  if (abs >= 10_000) return nlFixed(n, 2)
  if (abs >= 1)      return nlFixed(n, 4)
  if (abs >= 0.0001) return nlFixed(n, 6)
  return n.toExponential(3).replace('.', ',')
}

export function formatNum(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '-'
  return nlFixed(n, decimals)
}

export function formatMacd(n: number | null | undefined): string {
  if (n == null) return '-'
  const abs = Math.abs(n)
  if (abs === 0) return '0'
  if (abs >= 10)   return nlFixed(n, 2)
  if (abs >= 0.01) return nlFixed(n, 4)
  return nlFixed(n, 6)
}

// Compact large numbers with 2 decimals + suffix, e.g. "656,50B", "7,43K". Used for both
// market-indicator values and volumes.
export function formatCompact(n: number | null | undefined): string {
  if (n == null) return '-'
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return nlFixed(n / 1_000_000_000, 2) + 'B'
  if (abs >= 1_000_000)     return nlFixed(n / 1_000_000, 2) + 'M'
  if (abs >= 1_000)         return nlFixed(n / 1_000, 2) + 'K'
  return nlFixed(n, 2)
}

/** Whole-number European format with thousands grouping, e.g. 69009 -> "69.009". */
export function formatCount(n: number | null | undefined): string {
  if (n == null) return '-'
  return n.toLocaleString(LOCALE, { maximumFractionDigits: 0 })
}

// Candle date range, matching the C# signal grid notation:
// "2026-07-19 00:01 - 00:02" - full date + candle open time, then the candle
// close time only (open + interval duration).
export function formatCandleRange(open: string | Date | null | undefined, durationSec: number): string {
  if (open == null) return '-'
  const start = typeof open === 'string' ? new Date(open) : open
  const end = new Date(start.getTime() + durationSec * 1000)
  const date = start.toLocaleDateString('en-CA') // YYYY-MM-DD
  const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} ${clock(start)} - ${clock(end)}`
}

export function formatClock(d: string | Date | null | undefined): string {
  if (d == null) return '-'
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
