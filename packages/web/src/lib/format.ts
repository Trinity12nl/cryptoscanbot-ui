/** Small display helpers - US notation (deliberately not the C# European "0,7531"). */

export function fmtNum(n: number | null, digits = 2): string {
  if (n == null) return '-'
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtPrice(n: number | null): string {
  if (n == null) return '-'
  const d = n >= 1000 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 5 : 8
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/** Compact volume: 1.2M, 3.4K. */
export function fmtVol(n: number | null): string {
  if (n == null) return '-'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}

export function fmtTime(ms: number | null): string {
  if (ms == null) return '-'
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** Trend % -> tailwind text color class. */
export function trendColor(n: number | null): string {
  if (n == null) return 'text-muted'
  if (n >= 60) return 'text-long'
  if (n <= -60) return 'text-short'
  return 'text-ink'
}
