import { createColumnHelper, type RowData, type VisibilityState } from '@tanstack/react-table'
import { Zap } from 'lucide-react'
import {
  INTERVAL_SEC, isTrendDivergent, signalChangePct,
  type Signal, type SignalBarometer,
} from '@csb/shared'
import { usePrices } from '../context/PricesContext'
import { SIDE_BADGE_CLASS, pctClass, trendClass } from '../lib/enums'
import { formatCandleRange, formatCompact, formatMacd, formatNum, formatPrice } from '../lib/format'

// The five timeframes the engine snapshots per signal (barometer + trend), in ascending order.
const TF_KEYS: ReadonlyArray<readonly [keyof SignalBarometer, string]> = [
  ['m15', '15m'], ['m30', '30m'], ['h1', '1h'], ['h4', '4h'], ['d1', '1d'],
]

// Per-timeframe barometer readings as a compact inline row (one small coloured number per TF).
function BarometerCell({ signal }: { signal: Signal }) {
  const b = signal.barometer
  if (!b) return <span className="text-zinc-400 dark:text-zinc-500">-</span>
  return (
    <span className="inline-flex gap-1.5 tabular-nums text-xs">
      {TF_KEYS.map(([k, label]) => {
        const v = b[k]
        return (
          <span key={k} title={label} className={v == null ? 'text-zinc-300 dark:text-zinc-600' : pctClass(v)}>
            {v == null ? '·' : formatNum(v, 2)}
          </span>
        )
      })}
    </span>
  )
}

// Per-timeframe market-trend direction as compact arrows (up green / down red / unknown dot).
function TrendTfCell({ signal }: { signal: Signal }) {
  const t = signal.trend
  if (!t) return <span className="text-zinc-400 dark:text-zinc-500">-</span>
  return (
    <span className="inline-flex gap-1 text-xs">
      {TF_KEYS.map(([k, label]) => {
        const v = t[k]
        const cls = v === 'up' ? 'text-emerald-600 dark:text-emerald-400'
          : v === 'down' ? 'text-red-600 dark:text-red-400' : 'text-zinc-300 dark:text-zinc-600'
        return <span key={k} title={label} className={cls}>{v === 'up' ? '▲' : v === 'down' ? '▼' : '·'}</span>
      })}
    </span>
  )
}

// Colocate a plain-text label on each column so the column picker can render a
// checkbox list without duplicating the (sometimes JSX) header definitions.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    label: string
  }
}

// Signed percentage cell, coloured green/red.
function PercentCell({ v, decimals = 2 }: { v: number | null; decimals?: number }) {
  if (v == null) return <span className="text-zinc-400 dark:text-zinc-500">-</span>
  return <span className={pctClass(v)}>{formatNum(v, decimals)}%</span>
}

// Live price vs the signal price (%), re-rendering as prices flush (~4s). Coloured by whether the
// move FAVOURS the position, not raw sign: a drop is a gain for a short, so shorts invert the colour
// while the number stays the real change. Ported from the old app's ChangeCell.
function ChangeCell({ signal }: { signal: Signal }) {
  const prices = usePrices()
  const v = signalChangePct(signal.price, prices[signal.symbol])
  if (v == null) return <span className="text-zinc-400 dark:text-zinc-500">-</span>
  const favourable = signal.side === 'short' ? -v : v
  const cls = favourable > 0 ? 'text-emerald-600 dark:text-emerald-400'
    : favourable < 0 ? 'text-red-600 dark:text-red-400' : ''
  return <span className={cls}>{formatNum(v, 2)}%</span>
}

const col = createColumnHelper<Signal>()

// Order mirrors the C# signal grid: default-visible columns first, then the
// extras that live in the column picker (hidden by default).
export function buildSignalColumns() {
  return [
    // Id: leftmost when enabled, hidden by default (debugging aid).
    col.accessor('id', { id: 'id', meta: { label: 'Id' }, header: 'Id', cell: (i) => i.getValue() }),

    // --- default-visible (pinned core: enough to identify + act on a signal) ---
    col.accessor('openDateMs', {
      id: 'date', enableHiding: false, meta: { label: 'Candle date' }, header: 'Candle date',
      cell: (ctx) => {
        const s = ctx.row.original
        const ms = ctx.getValue()
        if (ms == null) return <span className="text-zinc-400 dark:text-zinc-500">-</span>
        return formatCandleRange(new Date(ms), INTERVAL_SEC[s.interval] ?? 0)
      },
    }),
    col.accessor('symbol', { id: 'symbol', enableHiding: false, meta: { label: 'Symbol' }, header: 'Symbol', cell: (i) => i.getValue() }),
    col.accessor('interval', { id: 'interval', enableHiding: false, meta: { label: 'Interval' }, header: 'Interval', cell: (i) => i.getValue() }),
    col.accessor('side', {
      id: 'side', enableHiding: false, meta: { label: 'Side' }, header: 'Side',
      cell: (i) => <span className={`px-1.5 py-0.5 rounded text-xs ${SIDE_BADGE_CLASS[i.getValue()]}`}>{i.getValue()}</span>,
    }),
    col.accessor('strategy', { id: 'strategy', enableHiding: false, meta: { label: 'Strategy' }, header: 'Strategy', cell: (i) => i.getValue() }),
    col.accessor('price', { id: 'price', enableHiding: false, meta: { label: 'Price' }, header: 'Price', cell: (i) => formatPrice(i.getValue()) }),
    col.display({
      id: 'change', meta: { label: 'Change' },
      header: () => <span title="Live price vs the signal price (%), coloured by whether it favours the position">Change</span>,
      cell: (ctx) => <ChangeCell signal={ctx.row.original} />,
    }),
    col.accessor('change24h', { id: 'change24h', meta: { label: '24h Change' }, header: '24h Change', cell: (i) => <PercentCell v={i.getValue()} /> }),
    col.accessor('volume', { id: 'volume', meta: { label: 'Volume' }, header: 'Volume', cell: (i) => formatCompact(i.getValue()) }),
    col.accessor('trendPrimary', {
      id: 'market', meta: { label: 'Trend·Dow' },
      header: () => <span title="Primary market-trend %: Dow-theory reading (-100 bearish .. +100 bullish)">Trend·Dow</span>,
      cell: (i) => <PercentCell v={i.getValue()} decimals={0} />,
    }),
    col.accessor('trendSecondary', {
      id: 'marketBos', meta: { label: 'Trend·BOS' },
      header: () => <span title="Secondary market-trend %: BOS/CHoCH reading. A ⚡ marks where it disagrees with Dow - a goodie the C# UI can't show.">Trend·BOS</span>,
      cell: (ctx) => {
        const s = ctx.row.original
        const v = ctx.getValue()
        return (
          <span className="inline-flex items-center gap-1">
            {isTrendDivergent(s) && <Zap size={11} className="text-amber-500" />}
            {v == null ? <span className="text-zinc-400 dark:text-zinc-500">-</span> : <span className={trendClass(v)}>{formatNum(v, 0)}%</span>}
          </span>
        )
      },
    }),
    col.accessor('bbPercentage', { id: 'bbPct', meta: { label: 'BB%' }, header: () => <span title="Price position within the Bollinger Bands (%)">BB%</span>, cell: (i) => formatNum(i.getValue()) }),

    // --- hidden-but-available (off by default; toggle in the column picker) ---
    col.accessor('exchange', { id: 'exchange', meta: { label: 'Exchange' }, header: 'Exchange', cell: (i) => i.getValue() }),
    col.accessor('eventText', { id: 'text', meta: { label: 'Text' }, header: 'Text', cell: (i) => i.getValue() || <span className="text-zinc-400 dark:text-zinc-500">-</span> }),
    col.accessor('effective', { id: 'effective', meta: { label: 'Effective' }, header: () => <span title="Effective price change % over the settings window">Eff%</span>, cell: (i) => <PercentCell v={i.getValue()} /> }),
    col.accessor('rsi', { id: 'rsi', meta: { label: 'RSI' }, header: 'RSI', cell: (i) => formatNum(i.getValue(), 1) }),
    col.accessor('stochOsc', { id: 'stoch', meta: { label: 'Stoch' }, header: 'Stoch', cell: (i) => formatNum(i.getValue(), 1) }),
    col.accessor('stochSig', { id: 'stochSignal', meta: { label: 'Stoch Signal' }, header: 'Stoch Sig', cell: (i) => formatNum(i.getValue(), 1) }),
    col.accessor('macdHistogram', { id: 'macdHist', meta: { label: 'MACD Hist' }, header: 'MACD Hist', cell: (i) => formatMacd(i.getValue()) }),
    col.accessor('barcode', { id: 'barcode', meta: { label: 'Barcode' }, header: () => <span title="Barcode / flatness metric">Barcode</span>, cell: (i) => formatNum(i.getValue()) }),
    col.display({
      id: 'baro', meta: { label: 'Barometer' },
      header: () => <span title="Market barometer per timeframe at signal time (15m 30m 1h 4h 1d)">Barometer</span>,
      cell: (ctx) => <BarometerCell signal={ctx.row.original} />,
    }),
    col.display({
      id: 'trendTf', meta: { label: 'Trend TF' },
      header: () => <span title="Market trend direction per timeframe at signal time (15m 30m 1h 4h 1d)">Trend TF</span>,
      cell: (ctx) => <TrendTfCell signal={ctx.row.original} />,
    }),
  ]
}

// Default-visible set = everything not listed here is hidden until picked.
export const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
  id: false,
  exchange: false,
  text: false,
  effective: false,
  rsi: false,
  stoch: false,
  stochSignal: false,
  macdHist: false,
  barcode: false,
  baro: false,
  trendTf: false,
}
