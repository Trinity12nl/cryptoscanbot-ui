import { Activity, Radio } from 'lucide-react'
import type { EngineInfo } from '@csb/shared'
import { ThemeToggle } from './ThemeToggle'
import { Changelog } from './Changelog'

export function Header({ info, live, signalCount }: {
  info: EngineInfo | null
  live: boolean
  signalCount: number
}) {
  const connected = info?.connected ?? false
  return (
    <header className="flex items-center gap-6 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-emerald-500" />
        <span className="text-sm font-semibold tracking-wide text-zinc-900 dark:text-zinc-100">CryptoScanBot</span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <span className="text-zinc-500 dark:text-zinc-400">Engine</span>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{info?.exchange ?? (connected ? 'connected' : 'offline')}</span>
      </div>

      <div className="flex items-center gap-1.5 text-sm">
        <Radio size={14} className={live ? 'text-emerald-500' : 'text-zinc-400'} />
        <span className="text-zinc-500 dark:text-zinc-400">{live ? 'live' : 'reconnecting…'}</span>
      </div>

      <div className="ml-auto flex items-center gap-5 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">
          Signals <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{signalCount}</span>
        </span>
        <Changelog />
        <ThemeToggle />
      </div>
    </header>
  )
}
