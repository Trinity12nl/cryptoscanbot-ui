import { Activity, Radio } from 'lucide-react'
import type { EngineInfo } from '@csb/shared'

export function Header({ info, live, signalCount }: {
  info: EngineInfo | null
  live: boolean
  signalCount: number
}) {
  const connected = info?.connected ?? false
  return (
    <header className="flex items-center gap-6 border-b border-edge bg-panel px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-accent" />
        <span className="text-sm font-semibold tracking-wide">CryptoScanBot</span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-long' : 'bg-short'}`} />
        <span className="text-muted">Engine</span>
        <span className="font-medium">{info?.exchange ?? (connected ? 'connected' : 'offline')}</span>
      </div>

      <div className="flex items-center gap-1.5 text-sm">
        <Radio size={14} className={live ? 'text-long' : 'text-muted'} />
        <span className="text-muted">{live ? 'live' : 'reconnecting…'}</span>
      </div>

      <div className="ml-auto text-sm">
        <span className="text-muted">Signals </span>
        <span className="font-mono font-semibold">{signalCount}</span>
      </div>
    </header>
  )
}
