import { Zap, Database, Loader2, WifiOff } from 'lucide-react'
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
  // Single connection-status pill (replaces the old separate "Engine ●" dot + radio): how signals are
  // actually reaching the UI. If our socket to the bridge is down we can't trust anything, so that
  // wins; then prefer the live SignalR link, fall back to DB polling, and finally show a real Offline
  // state when there's no database at all (rather than pretending to poll a DB that isn't there).
  const mode = !live
    ? { Icon: Loader2, spin: true, label: 'reconnecting…', cls: 'text-amber-500', title: 'Reconnecting to the local bridge…' }
    : info?.signalrConnected
      ? { Icon: Zap, spin: false, label: 'Live signals', cls: 'text-emerald-500', title: "Signals push in instantly via the scanner's SignalR hub." }
      : info?.signalrEnabled
        ? { Icon: Loader2, spin: true, label: 'connecting…', cls: 'text-amber-500', title: 'SignalR live link is enabled - waiting for the scanner hub (start the scanner with SignalR on).' }
        : info?.dbPresent
          ? { Icon: Database, spin: false, label: 'Polling (DB)', cls: 'text-zinc-400', title: 'Reading the database directly (SignalR live link is off).' }
          : { Icon: WifiOff, spin: false, label: 'Offline', cls: 'text-red-500', title: 'No scanner database found and no live link - nothing to read.' }
  const ModeIcon = mode.Icon

  return (
    <header className="flex items-center gap-6 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <img src="/logo.svg" alt="CryptoScanBot-ui" width={20} height={20} className="rounded-[5px]" />
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-wide text-zinc-900 dark:text-zinc-100">CryptoScanBot-ui</span>
          <span className="mt-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">v{__APP_VERSION__}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">Exchange</span>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{info?.exchange ?? '—'}</span>
      </div>

      <div className="flex items-center gap-1.5 text-sm" title={mode.title}>
        <ModeIcon size={14} className={`${mode.cls} ${mode.spin ? 'animate-spin' : ''}`} />
        <span className="text-zinc-500 dark:text-zinc-400">{mode.label}</span>
      </div>

      <div className="ml-auto flex items-center gap-5 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">
          <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{shown}</span> shown
          {' - '}
          <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{today}</span> today
        </span>
        <Changelog />
        <DataFolderSettings info={info} />
        <ThemeToggle />
      </div>
    </header>
  )
}
