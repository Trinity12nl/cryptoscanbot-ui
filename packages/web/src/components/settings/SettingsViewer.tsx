import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal, Loader2, Lock } from 'lucide-react'
import type { RawSettings } from '@csb/shared'
import { fetchRawSettings } from '../../lib/api'
import { ObjectFields } from './SettingsValue'

/**
 * Read-only viewer for the C# scanner's full configuration, laid out in the same tabs the scanner's
 * settings dialog uses (General, Signal, Trend, Indicators, Quote, Lists, Trading, Debug). Fed by the
 * bridge's `GET /api/settings/raw` (the settings file verbatim), so it works in both the Live and
 * Polling modes. Editing + write-back to the engine lands in a later phase; for now it is view-only.
 */

interface Tab {
  id: string
  label: string
  /** Render the tab body from the raw settings object, or null if the data isn't present. */
  render: (s: RawSettings) => React.ReactNode
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const isDebugKey = (k: string) => k.startsWith('Debug')
const INDICATOR_KEYS = ['SettingsBb', 'SettingsRsi', 'SettingsStoch']

const TABS: Tab[] = [
  {
    id: 'general',
    label: 'General',
    render: (s) => {
      const g = asObject(s.General)
      if (!g) return null
      // General also carries the indicator + debug blocks; those get their own tabs below.
      return <ObjectFields obj={g} omit={(k) => isDebugKey(k) || INDICATOR_KEYS.includes(k)} />
    },
  },
  { id: 'signal', label: 'Signal', render: (s) => renderObj(s.Signal) },
  { id: 'trend', label: 'Trend', render: (s) => renderObj(s.Trend) },
  {
    id: 'indicators',
    label: 'Indicators',
    render: (s) => {
      const g = asObject(s.General)
      if (!g) return null
      const picked: Record<string, unknown> = {}
      for (const k of INDICATOR_KEYS) if (k in g) picked[k] = g[k]
      return <ObjectFields obj={picked} />
    },
  },
  { id: 'quote', label: 'Quote', render: (s) => renderObj(s.QuoteCoins) },
  {
    id: 'lists',
    label: 'Lists',
    render: (s) => {
      const keys = ['WhiteListOversold', 'BlackListOversold', 'WhiteListOverbought', 'BlackListOverbought', 'ShowSymbolInformation']
      const picked: Record<string, unknown> = {}
      for (const k of keys) if (k in s) picked[k] = s[k]
      return <ObjectFields obj={picked} />
    },
  },
  { id: 'trading', label: 'Trading', render: (s) => renderObj(s.Trading) },
  {
    id: 'debug',
    label: 'Debug',
    render: (s) => {
      const g = asObject(s.General)
      if (!g) return null
      const picked: Record<string, unknown> = {}
      for (const k of Object.keys(g)) if (isDebugKey(k)) picked[k] = g[k]
      return <ObjectFields obj={picked} />
    },
  },
]

function renderObj(v: unknown): React.ReactNode {
  const o = asObject(v)
  return o ? <ObjectFields obj={o} /> : null
}

export function SettingsViewer() {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState<RawSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState('general')

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError(null)
    fetchRawSettings()
      .then((s) => { if (alive) setRaw(s) })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load settings') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open])

  const tab = useMemo(() => TABS.find((t) => t.id === active), [active])
  const body = raw && tab ? tab.render(raw) : null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Scanner settings"
        className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <SlidersHorizontal size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="flex h-[38rem] max-h-full w-[52rem] max-w-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Scanner settings</h2>
              <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                <Lock size={10} /> View only
              </span>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Tab rail */}
              <nav className="w-40 shrink-0 overflow-y-auto border-r border-zinc-200 p-2 dark:border-zinc-800">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActive(t.id)}
                    className={`block w-full rounded-md px-3 py-1.5 text-left text-xs ${
                      t.id === active
                        ? 'bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>

              {/* Content */}
              <div className="min-w-0 flex-1 overflow-y-auto px-5 py-3">
                {loading && (
                  <div className="flex items-center gap-2 py-6 text-xs text-zinc-500 dark:text-zinc-400">
                    <Loader2 size={14} className="animate-spin" /> Loading settings…
                  </div>
                )}
                {!loading && error && (
                  <p className="py-6 text-xs text-red-500 dark:text-red-400">{error}</p>
                )}
                {!loading && !error && !raw && (
                  <p className="py-6 text-xs text-zinc-500 dark:text-zinc-400">
                    {"No settings found. Start the scanner at least once so it writes its configuration."}
                  </p>
                )}
                {!loading && !error && raw && (body ?? (
                  <p className="py-6 text-xs text-zinc-400 dark:text-zinc-600">This section is empty in the current settings.</p>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {"Editing writes back to the engine in a later update - this is a read-only preview for now."}
              </span>
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
