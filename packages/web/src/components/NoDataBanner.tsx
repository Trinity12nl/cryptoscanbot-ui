import { useState } from 'react'
import { FolderOpen, AlertTriangle, Wand2, Loader2 } from 'lucide-react'
import type { EngineInfo } from '@csb/shared'
import { getDesktop } from '../lib/desktop'

/** Last path segment of a folder path (handles both \ and /), for a short button label. */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

// Shown when the bridge finds no scanner DB (or an empty one) at the path it's reading - the usual
// cause is an engine started with `-f "datafolder"` writing elsewhere, or the app pointed one folder
// off. Names the path and, when we spot a CryptoScanBot.db in a nearby folder, offers a one-click
// fix so an empty screen explains itself instead of looking broken.
export function NoDataBanner({ info, empty }: { info: EngineInfo | null; empty: boolean }) {
  const desktop = getDesktop()
  // Applying the suggestion restarts the bridge and reloads the page (~1-2s). Show an immediate
  // pending state so the click has visible feedback instead of looking dead until the reload snaps in.
  const [applying, setApplying] = useState(false)
  if (!info) return null
  const missing = !info.dbPresent
  if (!missing && !empty) return null

  // Only meaningful when the DB is actually missing; the bridge clears it once a DB is present.
  const suggestion = missing ? info.suggestedDataDir ?? null : null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
      <span className="flex items-center gap-1.5 font-medium">
        <AlertTriangle size={14} />
        {missing ? 'No scanner database found' : 'The scanner database is empty'}
      </span>
      <span className="text-amber-700 dark:text-amber-400/90">
        at <code className="break-all font-mono">{info.dbPath}</code>.
      </span>

      {suggestion ? (
        <>
          <span className="text-amber-700 dark:text-amber-400/90">
            {'Found a database in '}
            <code className="break-all font-mono">{suggestion}</code>
            {' - did you mean that folder?'}
          </span>
          {desktop ? (
            <button
              disabled={applying}
              onClick={() => {
                setApplying(true)
                void desktop.setDataFolder(suggestion).catch(() => setApplying(false))
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-200 px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-300 disabled:cursor-wait disabled:opacity-80 dark:border-amber-600/70 dark:bg-amber-800/40 dark:text-amber-100 dark:hover:bg-amber-800/60"
            >
              {applying
                ? <><Loader2 size={13} className="animate-spin" /> Switching folder…</>
                : <><Wand2 size={13} /> Use {baseName(suggestion)}</>}
            </button>
          ) : (
            <span className="text-amber-700 dark:text-amber-400/90">
              (dev: set <code className="font-mono">CSB_DATA_DIR</code> to that path)
            </span>
          )}
        </>
      ) : (
        <>
          <span className="text-amber-700 dark:text-amber-400/90">
            If you started the engine with{' '}
            <code className="font-mono">-f &quot;datafolder&quot;</code>, point the app at that folder.
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
        </>
      )}
    </div>
  )
}
