import { useEffect, useMemo, useState } from 'react'
import {
  SlidersHorizontal, Loader2, Lock, RotateCcw, ArrowLeftRight, Activity, Coins,
  Target, LineChart, Wallet, ListChecks, Bug, type LucideIcon,
} from 'lucide-react'
import type { RawSettings } from '@csb/shared'
import { fetchRawSettings } from '../../lib/api'
import { ObjectFields, EditContext, isPlainObject, type Path } from './SettingsValue'

/**
 * Settings viewer/editor for the C# scanner's full configuration, laid out in the same tabs the
 * scanner's settings dialog uses (Exchange, Indicators, Basecoins, Strategies, Analyzer, Trader,
 * Lists, Debug). Fed by the bridge's `GET /api/settings/raw` (the settings file verbatim), so it
 * works in both Live and Polling modes. Fields are editable against a local draft; persisting that
 * draft back to the engine lands in a later phase (Save is intentionally disabled for now).
 */

interface Tab {
  id: string
  label: string
  Icon: LucideIcon
  /** Render the tab body from the (draft) settings object, or null if the data isn't present. */
  render: (s: RawSettings) => React.ReactNode
}

const asObject = (v: unknown): Record<string, unknown> | null => (isPlainObject(v) ? v : null)

const isDebugKey = (k: string) => k.startsWith('Debug')
const INDICATOR_KEYS = ['SettingsBb', 'SettingsRsi', 'SettingsStoch']

/** Pick a subset of keys from an object, preserving the given order. */
function pick(obj: Record<string, unknown> | null, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (obj) for (const k of keys) if (k in obj) out[k] = obj[k]
  return out
}

/** Immutably set a nested value by absolute path (used to update the draft on every edit). */
function setAtPath(root: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (Array.isArray(root)) {
    const clone = [...root]
    const idx = Number(head)
    clone[idx] = setAtPath(clone[idx], rest, value)
    return clone
  }
  const base = isPlainObject(root) ? root : {}
  const key = String(head)
  return { ...base, [key]: setAtPath(base[key], rest, value) }
}

const TABS: Tab[] = [
  {
    id: 'exchange',
    label: 'Exchange',
    Icon: ArrowLeftRight,
    // The scanner's Exchange/Common tab: everything in General except the indicator + debug blocks,
    // which get their own tabs below.
    render: (s) => renderObj(s.General, ['General'], (k) => isDebugKey(k) || INDICATOR_KEYS.includes(k)),
  },
  {
    id: 'indicators',
    label: 'Indicators',
    Icon: Activity,
    render: (s) => <ObjectFields obj={pick(asObject(s.General), INDICATOR_KEYS)} path={['General']} cardGrid />,
  },
  { id: 'basecoins', label: 'Basecoins', Icon: Coins, render: (s) => renderObj(s.QuoteCoins, ['QuoteCoins']) },
  { id: 'strategies', label: 'Strategies', Icon: Target, render: (s) => renderObj(s.Signal, ['Signal']) },
  { id: 'analyzer', label: 'Analyzer', Icon: LineChart, render: (s) => renderObj(s.Trend, ['Trend']) },
  { id: 'trader', label: 'Trader', Icon: Wallet, render: (s) => renderObj(s.Trading, ['Trading']) },
  {
    id: 'lists',
    label: 'Lists',
    Icon: ListChecks,
    render: (s) => (
      <ObjectFields
        obj={pick(s, ['WhiteListOversold', 'BlackListOversold', 'WhiteListOverbought', 'BlackListOverbought', 'ShowSymbolInformation'])}
        path={[]}
      />
    ),
  },
  {
    id: 'debug',
    label: 'Debug',
    Icon: Bug,
    render: (s) => {
      const g = asObject(s.General)
      return <ObjectFields obj={pick(g, Object.keys(g ?? {}).filter(isDebugKey))} path={['General']} />
    },
  },
]

function renderObj(v: unknown, path: Path, omit?: (k: string) => boolean): React.ReactNode {
  const o = asObject(v)
  return o ? <ObjectFields obj={o} path={path} omit={omit} /> : null
}

export function SettingsViewer() {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState<RawSettings | null>(null)
  const [draft, setDraft] = useState<RawSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState('exchange')

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError(null)
    fetchRawSettings()
      .then((s) => { if (alive) { setRaw(s); setDraft(s ? structuredClone(s) : null) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load settings') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open])

  const onEdit = useMemo(
    () => (path: Path, value: unknown) => setDraft((d) => (d ? (setAtPath(d, path, value) as RawSettings) : d)),
    [],
  )

  const tab = useMemo(() => TABS.find((t) => t.id === active), [active])
  const body = draft && tab ? tab.render(draft) : null
  const dirty = useMemo(() => JSON.stringify(raw) !== JSON.stringify(draft), [raw, draft])

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            className="flex h-[40rem] max-h-full w-[58rem] max-w-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={15} className="text-zinc-400 dark:text-zinc-500" />
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Scanner settings</h2>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                <Lock size={10} /> Save disabled
              </span>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Tab rail */}
              <nav className="w-44 shrink-0 space-y-0.5 overflow-y-auto border-r border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
                {TABS.map((t) => {
                  const on = t.id === active
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActive(t.id)}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                        on
                          ? 'bg-white font-semibold text-zinc-900 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700'
                          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200'
                      }`}
                    >
                      <t.Icon size={14} className={on ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-500'} />
                      {t.label}
                    </button>
                  )
                })}
              </nav>

              {/* Content */}
              <div className="min-w-0 flex-1 overflow-y-auto bg-zinc-50/40 px-5 py-4 dark:bg-transparent">
                {loading && (
                  <div className="flex items-center gap-2 py-6 text-xs text-zinc-500 dark:text-zinc-400">
                    <Loader2 size={14} className="animate-spin" /> Loading settings…
                  </div>
                )}
                {!loading && error && (
                  <p className="py-6 text-xs text-red-500 dark:text-red-400">{error}</p>
                )}
                {!loading && !error && !draft && (
                  <p className="py-6 text-xs text-zinc-500 dark:text-zinc-400">
                    {"No settings found. Start the scanner at least once so it writes its configuration."}
                  </p>
                )}
                {!loading && !error && draft && (
                  <EditContext.Provider value={onEdit}>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                      {tab && <tab.Icon size={15} className="text-emerald-500" />}
                      {tab?.label}
                    </h3>
                    {body ?? (
                      <p className="py-6 text-xs text-zinc-400 dark:text-zinc-600">This section is empty in the current settings.</p>
                    )}
                  </EditContext.Provider>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {dirty
                  ? "Edited (preview only) - writing back to the engine lands in a later update."
                  : "Editing writes back to the engine in a later update - fields are editable as a preview."}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDraft(raw ? structuredClone(raw) : null)}
                  disabled={!dirty}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <RotateCcw size={12} /> Reset
                </button>
                <button
                  disabled
                  title="Saving to the engine isn't wired up yet - coming in a later update."
                  className="cursor-not-allowed rounded-md bg-emerald-600/40 px-3 py-1.5 text-xs font-medium text-white opacity-60"
                >
                  Save
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
