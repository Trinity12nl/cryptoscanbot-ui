import type { Signal } from '@csb/shared'
import { fmtPrice, fmtTime, fmtVol, trendColor } from '../lib/format.ts'

const HEAD = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted'
const CELL = 'px-3 py-1.5 text-sm whitespace-nowrap'

export function SignalsTable({ signals, flashIds }: { signals: Signal[]; flashIds: Set<number> }) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr className="border-b border-edge">
            <th className={HEAD}>Time</th>
            <th className={HEAD}>Symbol</th>
            <th className={HEAD}>Iv</th>
            <th className={HEAD}>Strategy</th>
            <th className={HEAD}>Side</th>
            <th className={`${HEAD} text-right`}>Price</th>
            <th className={`${HEAD} text-right`}>Volume</th>
            <th className={`${HEAD} text-right`}>Trend·Dow</th>
            <th className={`${HEAD} text-right`}>Trend·BOS</th>
            <th className={`${HEAD} text-right`}>BB%</th>
          </tr>
        </thead>
        <tbody>
          {signals.length === 0 && (
            <tr><td colSpan={10} className="px-3 py-10 text-center text-muted">
              No signals yet - the engine fires them as candles close.
            </td></tr>
          )}
          {signals.map((s) => (
            <tr
              key={s.id}
              className={`border-b border-edge/50 transition-colors ${
                flashIds.has(s.id) ? 'bg-accent/15' : 'hover:bg-panel2'
              }`}
            >
              <td className={`${CELL} text-muted`}>{fmtTime(s.openDateMs)}</td>
              <td className={`${CELL} font-medium`}>{s.symbol}</td>
              <td className={`${CELL} text-muted`}>{s.interval}</td>
              <td className={CELL}>{s.strategy}</td>
              <td className={`${CELL} font-semibold ${s.side === 'long' ? 'text-long' : 'text-short'}`}>
                {s.side}
              </td>
              <td className={`${CELL} text-right font-mono`}>{fmtPrice(s.price)}</td>
              <td className={`${CELL} text-right font-mono text-muted`}>{fmtVol(s.volume)}</td>
              <td className={`${CELL} text-right font-mono ${trendColor(s.trendPrimary)}`}>
                {s.trendPrimary == null ? '-' : s.trendPrimary.toFixed(1)}
              </td>
              <td className={`${CELL} text-right font-mono ${trendColor(s.trendSecondary)}`}>
                {s.trendSecondary == null ? '-' : s.trendSecondary.toFixed(1)}
              </td>
              <td className={`${CELL} text-right font-mono text-muted`}>
                {s.bbPercentage == null ? '-' : s.bbPercentage.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
