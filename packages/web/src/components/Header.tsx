import { Radio } from 'lucide-react'
import type { EngineInfo } from '@csb/shared'
import { ThemeToggle } from './ThemeToggle'
import { Changelog } from './Changelog'
import { DataFolderSettings } from './DataFolderSettings'

export function Header({ info, live, shown, today }: {
  info: EngineInfo | null
  live: boolean
  shown: number
  today: number
}) {
  const connected = info?.connected ?? false
  return (
    <header className="flex items-center gap-6 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <img src="/logo.svg" alt="CryptoScanBot-ui" width={20} height={20} className="rounded-[5px]" />
        <span className="text-sm font-semibold tracking-wide text-zinc-900 dark:text-zinc-100">CryptoScanBot-ui</span>
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
          <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{shown}</span> shown
          {' - '}
          <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{today}</span> today
        </span>
        <Changelog />
        <DataFolderSettings dbPath={info?.dbPath ?? null} />
        <ThemeToggle />
      </div>
    </header>
  )
}
