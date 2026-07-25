import { useEffect, useState } from 'react'
import { Settings, FolderOpen, RotateCcw, Loader2 } from 'lucide-react'
import type { EngineInfo } from '@csb/shared'
import { getDesktop, type DataFolderState } from '../lib/desktop'
import { SignalRToggle } from './SignalRToggle'

// Gear button + Settings modal: view/change where the bridge reads the engine's DB, and toggle the
// SignalR live link. Lets a user who started the engine with `-f "datafolder"` point the app at that
// folder. Desktop-only controls; in the browser it shows the current path and the dev fallbacks.
export function DataFolderSettings({ info }: { info: EngineInfo | null }) {
  const dbPath = info?.dbPath ?? null
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<DataFolderState | null>(null)
  // Changing the folder restarts the bridge and reloads the page (~1-2s); show a pending state so the
  // action has visible feedback instead of looking dead until the reload happens.
  const [busy, setBusy] = useState(false)
  const desktop = getDesktop()

  useEffect(() => {
    if (!open || !desktop) return
    desktop.getDataFolder().then(setState).catch(() => setState(null))
  }, [open, desktop])

  // On success the main process persists, restarts the bridge and reloads the page, so we don't need
  // to update local state here - we only clear `busy` if the action didn't proceed (dialog cancelled
  // or an error), since a successful change reloads the whole page.
  const pick = () => {
    setBusy(true)
    desktop?.pickDataFolder().then((r) => { if (!r) setBusy(false) }).catch(() => setBusy(false))
  }
  const reset = () => {
    setBusy(true)
    desktop?.clearDataFolder().catch(() => setBusy(false))
  }

  const shown = state?.dbPath ?? dbPath ?? '-'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Data folder settings"
        className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <Settings size={16} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[34rem] max-w-full rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Engine data folder</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {"The app reads the C# engine's database here. If you started the engine with "}
              <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">-f &quot;datafolder&quot;</code>
              {', point it at that folder so signals show up.'}
            </p>

            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Current database</div>
              <div className="mt-0.5 break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">{shown}</div>
            </div>

            {desktop ? (
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={pick}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {busy
                    ? <><Loader2 size={13} className="animate-spin" /> Switching…</>
                    : <><FolderOpen size={13} /> Choose folder…</>}
                </button>
                {state?.dataDir && (
                  <button
                    onClick={reset}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-70 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <RotateCcw size={13} /> Reset to default
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                {'Folder picking is available in the desktop app. In the browser/dev, set '}
                <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">CSB_DATA_DIR</code>
                {' on the bridge.'}
              </p>
            )}

            <SignalRToggle info={info} />

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
