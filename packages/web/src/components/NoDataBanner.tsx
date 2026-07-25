import { FolderOpen, AlertTriangle } from 'lucide-react'
import type { EngineInfo } from '@csb/shared'
import { getDesktop } from '../lib/desktop'

// Shown when the bridge finds no scanner DB (or an empty one) at the path it's reading - the usual
// cause is an engine started with `-f "datafolder"` writing elsewhere. Names the path and offers the
// fix, so an empty screen explains itself instead of looking broken.
export function NoDataBanner({ info, empty }: { info: EngineInfo | null; empty: boolean }) {
  const desktop = getDesktop()
  if (!info) return null
  const missing = !info.dbPresent
  if (!missing && !empty) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
      <span className="flex items-center gap-1.5 font-medium">
        <AlertTriangle size={14} />
        {missing ? 'No scanner database found' : 'The scanner database is empty'}
      </span>
      <span className="text-amber-700 dark:text-amber-400/90">
        at <code className="break-all font-mono">{info.dbPath}</code>. If you started the engine with
        {' '}<code className="font-mono">-f &quot;datafolder&quot;</code>, point the app at that folder.
      </span>
      {desktop ? (
        <button
          onClick={() => { void desktop.pickDataFolder().catch(() => {}) }}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-100 px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-200 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
        >
          <FolderOpen size={13} /> Choose data folder…
        </button>
      ) : (
        <span className="text-amber-700 dark:text-amber-400/90">
          (dev: set <code className="font-mono">CSB_DATA_DIR</code> on the bridge)
        </span>
      )}
    </div>
  )
}
