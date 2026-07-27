import type { BarometerPoint } from '@csb/shared'

/**
 * Barometer line graph - ported from the old app (CryptoScanBot-new BarometerChart) so we don't
 * reinvent the wheel. Green above the zero line, red below, faint hour/percent grid, matching the C#
 * scanner's barometer. Only the input shape changed: it now takes the bridge's BarometerPoint[]
 * ({ tMs, value }) instead of the old { ts, v }.
 */

interface Props {
  points: BarometerPoint[]
  width: number
  height: number
}

const PAD_L = 30  // y-axis labels
const PAD_R = 6
const PAD_T = 6
const PAD_B = 16  // x-axis time labels

const HOUR_MS = 3_600_000

export function BarometerChart({ points, width, height }: Props) {
  const plotW = width - PAD_L - PAD_R
  const plotH = height - PAD_T - PAD_B

  if (points.length < 2) {
    return (
      <svg width={width} height={height}>
        <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle"
          fill="currentColor" className="text-zinc-400 dark:text-zinc-600" fontSize={11}>
          Warming up - data accumulates over time
        </text>
      </svg>
    )
  }

  // Y scale: auto, but always show zero and keep a minimum span of 3 (e.g. -1.5..+1.5).
  const values = points.map((p) => p.value)
  let yMin = Math.min(0, ...values)
  let yMax = Math.max(0, ...values)
  const span = yMax - yMin
  if (span < 3) {
    const pad = (3 - span) / 2
    yMin -= pad
    yMax += pad
  }
  const yPad = (yMax - yMin) * 0.05
  yMin -= yPad
  yMax += yPad

  const xMin = points[0]!.tMs
  const xMax = points[points.length - 1]!.tMs

  const toX = (ts: number): number => PAD_L + ((ts - xMin) / (xMax - xMin || 1)) * plotW
  const toY = (v: number): number => PAD_T + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH

  const zeroY = toY(0)
  const line = points.map((p) => `${toX(p.tMs).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ')

  const gridYs: number[] = []
  for (let v = Math.ceil(yMin); v <= Math.floor(yMax); v++) gridYs.push(v)

  const hourMarks: number[] = []
  for (let ts = Math.ceil(xMin / HOUR_MS) * HOUR_MS; ts <= xMax; ts += HOUR_MS) hourMarks.push(ts)

  // Unique id suffix so multiple charts on the page don't share clip paths.
  const uid = `baro-${xMin}`

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <clipPath id={`${uid}-above`}>
          <rect x={PAD_L} y={PAD_T} width={plotW} height={Math.max(0, zeroY - PAD_T)} />
        </clipPath>
        <clipPath id={`${uid}-below`}>
          <rect x={PAD_L} y={zeroY} width={plotW} height={Math.max(0, PAD_T + plotH - zeroY)} />
        </clipPath>
      </defs>

      {/* Vertical hour grid lines */}
      {hourMarks.map((ts) => (
        <line key={ts} x1={toX(ts)} y1={PAD_T} x2={toX(ts)} y2={PAD_T + plotH}
          stroke="currentColor" strokeWidth={0.5} className="text-zinc-300 dark:text-zinc-700" />
      ))}

      {/* Horizontal percent grid lines (zero line accented red, like the scanner) */}
      {gridYs.map((v) => (
        <g key={v}>
          <line x1={PAD_L} y1={toY(v)} x2={PAD_L + plotW} y2={toY(v)}
            stroke="currentColor" strokeWidth={v === 0 ? 1 : 0.5}
            className={v === 0 ? 'text-red-400 dark:text-red-500' : 'text-zinc-300 dark:text-zinc-700'} />
          <text x={PAD_L - 4} y={toY(v)} textAnchor="end" dominantBaseline="middle"
            fontSize={9} fill="currentColor" className="text-zinc-400 dark:text-zinc-500">
            {v > 0 ? `+${v}` : v}
          </text>
        </g>
      ))}

      {/* The line: green segment above zero, red segment below (clipped halves of the same path). */}
      <polyline points={line} fill="none" stroke="#16a34a" strokeWidth={1.5} clipPath={`url(#${uid}-above)`} />
      <polyline points={line} fill="none" stroke="#ef4444" strokeWidth={1.5} clipPath={`url(#${uid}-below)`} />

      {/* X-axis hour labels */}
      {hourMarks.map((ts) => (
        <text key={ts} x={toX(ts)} y={PAD_T + plotH + 11} textAnchor="middle" fontSize={9}
          fill="currentColor" className="text-zinc-400 dark:text-zinc-500">
          {new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </text>
      ))}
    </svg>
  )
}
