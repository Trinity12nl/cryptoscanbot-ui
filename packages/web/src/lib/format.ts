export function formatPrice(n: number | null | undefined): string {
  if (n == null) return '-'
  const abs = Math.abs(n)
  if (abs >= 10_000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (abs >= 1)      return n.toFixed(4)
  if (abs >= 0.0001) return n.toFixed(6)
  return n.toExponential(3)
}

export function formatNum(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '-'
  return n.toFixed(decimals)
}

export function formatMacd(n: number | null | undefined): string {
  if (n == null) return '-'
  const abs = Math.abs(n)
  if (abs === 0) return '0'
  if (abs >= 10)   return n.toFixed(2)
  if (abs >= 0.01) return n.toFixed(4)
  return n.toFixed(6)
}

export function formatCompact(n: number | null | undefined): string {
  if (n == null) return '-'
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(0)
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
