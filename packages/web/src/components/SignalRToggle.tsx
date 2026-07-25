import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { EngineInfo } from '@csb/shared'
import { getDesktop, type SignalrState } from '../lib/desktop'

// The SignalR "live link" toggle inside the Settings modal. Turning it on makes OUR bridge connect to
// the C# engine's hub (real liveness + instant push instead of file polling). Desktop-only - in
// dev/browser the link is set via CSB_SIGNALR on the bridge, so we show that note instead. The engine
// side (its own SignalREnabled + a running scanner) is surfaced as live status, never silently flipped.
export function SignalRToggle({ info }: { info: EngineInfo | null }) {
  const desktop = getDesktop()
  const [state, setState] = useState<SignalrState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!desktop) return
    desktop.getSignalr().then(setState).catch(() => setState(null))
  }, [desktop])

  const enabled = state?.enabled ?? info?.signalrEnabled ?? false

  const toggle = () => {
    if (!desktop) return
    setBusy(true)
    // No page reload: the main process restarts the bridge, the live WebSocket reconnects, and the
    // status below updates in place. Reflect the new toggle value from the IPC result right away.
    desktop.setSignalr(!enabled)
      .then((st) => setState(st))
      .catch(() => { /* leave the previous state */ })
      .finally(() => setBusy(false))
  }

  // Status line: off / live / enabled-but-waiting (with an engine-side hint).
  let statusText: string
  let dotClass: string
  if (!enabled) {
    statusText = 'Off - reading the database directly (file polling).'
    dotClass = 'bg-zinc-400'
  } else if (info?.signalrConnected) {
    statusText = 'Live - connected to the scanner hub.'
    dotClass = 'bg-emerald-500'
  } else {
    const engineOff = info?.engineSignalrEnabled === false
    statusText = engineOff
      ? 'Enabled here, but the scanner has SignalR turned off - enable it in the scanner settings and restart it.'
      : 'Enabled - waiting for the scanner hub. Make sure SignalR is on in the scanner and it is running.'
    dotClass = 'bg-amber-500'
  }

  return (
    <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-700">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Live link (SignalR)</h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {'Connect to the scanner for instant signals + real "online" status, instead of polling the database.'}
          </p>
        </div>
        {desktop ? (
          <button
            role="switch"
            aria-checked={enabled}
            disabled={busy}
            onClick={toggle}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-wait disabled:opacity-70 ${
              enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
          >
            <span
              className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            >
              {busy && <Loader2 size={11} className="animate-spin text-zinc-500" />}
            </span>
          </button>
        ) : null}
      </div>

      {desktop ? (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
          <span>{busy ? 'Switching…' : statusText}</span>
        </div>
      ) : (
        <p className="mt-2.5 text-xs text-zinc-500 dark:text-zinc-400">
          {'The toggle is available in the desktop app. In the browser/dev, enable it with '}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">CSB_SIGNALR=1</code>
          {' on the bridge.'}
        </p>
      )}
    </div>
  )
}
