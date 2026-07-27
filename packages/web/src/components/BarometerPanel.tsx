import type { Barometer, BarometerGraph } from '@csb/shared'
import { BarometerChart } from './BarometerChart'

/**
 * The scanner-header "Barometer" column: quote + interval selectors, the graph, and the 1h/4h/1d
 * readings - always visible, like the C# scanner. While the scanner is still loading candles
 * (Ready=false) the graph area shows pulsating red/green bars + the progress text, never a
 * half-filled graph (Inge's chosen loading state).
 */

export const BARO_INTERVALS = ['1h', '4h', '1d'] as const

const CHART_W = 340
const CHART_H = 118

interface Props {
  quotes: string[]
  quote: string
  onQuote: (q: string) => void
  interval: string
  onInterval: (iv: string) => void
  graph: BarometerGraph | null
  tip: Barometer | null
}

function signClass(v: number | null | undefined): string {
  if (v == null) return 'text-zinc-400 dark:text-zinc-500'
  if (v > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (v < 0) return 'text-red-500 dark:text-red-400'
  return 'text-zinc-600 dark:text-zinc-300'
}

function TipValue({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-400 dark:text-zinc-500">Barometer {label}:</span>
      <span className={`font-mono font-semibold ${signClass(value)}`}>
        {value != null ? (value > 0 ? '+' : '') + value.toFixed(2) : '-'}
      </span>
    </div>
  )
}

// Deterministic "candle" pattern so the loading state looks like the scanner's pulsating candles
// (thin grey wick + a narrow green/red body at a varied height) rather than fat bars.
const CANDLE_UP = [true, false, true, true, false, true, false, false, true, false, true, true, false]
const LABEL_H = 16

/** Pulsating candlesticks shown while the scanner is still loading (Ready=false), matching the C#
 * scanner's loading barometer. Progress sits below the candles, never over them. */
function LoadingBars({ progress }: { progress: string }) {
  const areaH = CHART_H - LABEL_H
  const n = CANDLE_UP.length
  const step = CHART_W / n
  const bodyW = Math.min(8, step * 0.5)

  return (
    <div style={{ width: CHART_W, height: CHART_H }}>
      <svg width={CHART_W} height={areaH}>
        {CANDLE_UP.map((up, i) => {
          const cx = step * (i + 0.5)
          const bodyH = 30 + ((i * 27) % 26) // base height; the animation scales it up/down
          const centerY = areaH / 2 + (((i * 13) % 20) - 10)
          // Fixed wick, uniform-ish full height - only the body pulses (grows/shrinks).
          const wickTop = 5
          const wickBot = areaH - 5
          return (
            <g key={i}>
              <line x1={cx} y1={wickTop} x2={cx} y2={wickBot} strokeWidth={1}
                stroke="currentColor" className="text-zinc-300 dark:text-zinc-600" />
              <rect className={`baro-candle ${up ? 'fill-emerald-500' : 'fill-red-500'}`}
                x={cx - bodyW / 2} y={centerY - bodyH / 2} width={bodyW} height={bodyH} rx={1.5}
                style={{ animationDelay: `${i * 110}ms` }} />
            </g>
          )
        })}
      </svg>
      <div className="text-center text-[10px] text-zinc-500 dark:text-zinc-400" style={{ height: LABEL_H }}>
        {progress ? `Loading candles... ${progress}` : 'Loading candles...'}
      </div>
    </div>
  )
}

export function BarometerPanel({ quotes, quote, onQuote, interval, onInterval, graph, tip }: Props) {
  const ready = graph?.ready ?? tip?.ready ?? false
  const progress = graph?.progress || tip?.progress || ''
  const selectCls =
    'rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-700 ' +
    'dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <span className="font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Barometer</span>
      <div className="flex gap-3">
        {/* Left sub-column: selectors on top, the 1h/4h/1d readings below - beside the graph, like
            the scanner. justify-between spreads them over the graph's height so nothing floats. */}
        <div className="flex flex-col justify-between gap-2 py-0.5">
          <div className="flex gap-1.5">
            <select className={selectCls} value={quote} onChange={(e) => onQuote(e.target.value)}>
              {(quotes.length ? quotes : [quote]).map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
            <select className={selectCls} value={interval} onChange={(e) => onInterval(e.target.value)}>
              {BARO_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-0.5">
            <TipValue label="1h" value={tip?.h1} />
            <TipValue label="4h" value={tip?.h4} />
            <TipValue label="1d" value={tip?.d1} />
          </div>
        </div>

        {ready && graph ? (
          <BarometerChart points={graph.points} width={CHART_W} height={CHART_H} />
        ) : (
          <LoadingBars progress={progress} />
        )}
      </div>
    </div>
  )
}
