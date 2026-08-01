import { useEffect, useMemo, useState } from 'react'
import {
  SlidersHorizontal, Loader2, Check, RotateCcw, ArrowLeftRight, Activity, Coins,
  Target, LineChart, Wallet, ListChecks, Bug, KeyRound, AlertTriangle, type LucideIcon,
} from 'lucide-react'
import type { RawSettings } from '@csb/shared'
import { fetchRawSettings, saveRawSettings } from '../../lib/api'
import { ObjectFields, EditContext, isPlainObject, type Path } from './SettingsValue'
import { ApiKeysTab } from './ApiKeysTab'

/** The API-keys tab is special: it drives the engine's own Telegram/Altrady code with a working Save,
 * so it renders its own self-contained component instead of the raw-settings draft. */
const API_KEYS_TAB = 'apikeys'

/**
 * Settings viewer/editor for the C# scanner's full configuration, laid out in the same tabs the
 * scanner's settings dialog uses (Exchange, Indicators, Basecoins, Strategies, Analyzer, Trader,
 * Lists, Debug). Fed by the bridge's `GET /api/settings/raw` (the settings file verbatim), so it
 * works in both Live and Polling modes. Fields are editable against a local draft; Save writes the
 * draft back through the bridge's `POST /api/settings` -> hub `ApplySettings`, which persists it and
 * applies it live. Exchange switching + base-coin (quote) changes are fenced off engine-side (they need
 * the scanner's destructive stop/clear/reload) - those tabs carry an amber notice.
 */

interface Tab {
  id: string
  label: string
  Icon: LucideIcon
  /** Render the tab body from the (draft) settings object, or null if the data isn't present. */
  render: (s: RawSettings) => React.ReactNode
  /** Optional amber notice shown above the body when some fields on this tab are fenced off (the engine
   * ignores them on save because applying them needs the scanner's destructive stop/clear/reload). */
  notice?: string
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
    notice: "The active exchange can't be switched from here yet - that needs a scanner restart. Every other field on this tab applies live.",
  },
  {
    id: 'indicators',
    label: 'Indicators',
    Icon: Activity,
    render: (s) => <ObjectFields obj={pick(asObject(s.General), INDICATOR_KEYS)} path={['General']} cardGrid />,
  },
  {
    id: 'basecoins',
    label: 'Basecoins',
    Icon: Coins,
    render: (s) => renderObj(s.QuoteCoins, ['QuoteCoins']),
    notice: "Base-coin (quote) changes aren't applied live yet - set which coins to fetch in the scanner. Saving here leaves them untouched.",
  },
  { id: 'strategies', label: 'Strategies', Icon: Target, render: (s) => renderObj(s.Signal, ['Signal']) },
  { id: 'analyzer', label: 'Analyzer', Icon: LineChart, render: (s) => renderObj(s.Trend, ['Trend']) },
  { id: 'trader', label: 'Trader', Icon: Wallet, render: (s) => renderObj(s.Trading, ['Trading']) },
  // Special: renders <ApiKeysTab/> (its own data + working Save), not the raw-settings draft.
  { id: API_KEYS_TAB, label: 'API keys', Icon: KeyRound, render: () => null },
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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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
  const isApiKeys = active === API_KEYS_TAB

  async function save() {
    if (!draft) return
    setSaving(true); setSaveError(null); setSaved(false)
    try {
      // The engine echoes back the persisted settings (with the fenced-off exchange/quote fields at
      // their real values), so adopt that as the new baseline - any fenced edits visibly revert.
      const persisted = await saveRawSettings(draft)
      setRaw(persisted)
      setDraft(structuredClone(persisted))
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
      // A save can fail AFTER the engine already persisted part of the change, which would leave our
      // baseline (`raw`) stale - so a revert-to-original looks "unchanged" and Save greys out even
      // though the engine differs. Re-pull the authoritative settings as the new baseline; keep the
      // user's draft so they can still see/retry their edit against the truth.
      try {
        const fresh = await fetchRawSettings()
        if (fresh) setRaw(fresh)
      } catch { /* leave the baseline as-is if the refresh also fails */ }
    } finally {
      setSaving(false)
    }
  }

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
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                <Check size={10} /> Saves live
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
                {isApiKeys && (
                  <>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                      {tab && <tab.Icon size={15} className="text-emerald-500" />}
                      {tab?.label}
                    </h3>
                    <ApiKeysTab />
                  </>
                )}
                {!isApiKeys && loading && (
                  <div className="flex items-center gap-2 py-6 text-xs text-zinc-500 dark:text-zinc-400">
                    <Loader2 size={14} className="animate-spin" /> Loading settings…
                  </div>
                )}
                {!isApiKeys && !loading && error && (
                  <p className="py-6 text-xs text-red-500 dark:text-red-400">{error}</p>
                )}
                {!isApiKeys && !loading && !error && !draft && (
                  <p className="py-6 text-xs text-zinc-500 dark:text-zinc-400">
                    {"No settings found. Start the scanner at least once so it writes its configuration."}
                  </p>
                )}
                {!isApiKeys && !loading && !error && draft && (
                  <EditContext.Provider value={onEdit}>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                      {tab && <tab.Icon size={15} className="text-emerald-500" />}
                      {tab?.label}
                    </h3>
                    {tab?.notice && (
                      <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                        <AlertTriangle size={13} className="mt-px shrink-0" />
                        <span>{tab.notice}</span>
                      </div>
                    )}
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
                {isApiKeys
                  ? "API keys save straight to the engine (each section has its own Save)."
                  : saveError
                    ? <span className="text-red-500 dark:text-red-400">{saveError}</span>
                    : dirty
                      ? "Save writes these changes to the engine and applies them live."
                      : "Edits are written back to the engine and applied live on Save."}
              </span>
              <div className="flex items-center gap-2">
                {!isApiKeys && (
                  <>
                    <button
                      onClick={() => { setDraft(raw ? structuredClone(raw) : null); setSaveError(null) }}
                      disabled={!dirty || saving}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <RotateCcw size={12} /> Reset
                    </button>
                    <button
                      onClick={() => void save()}
                      disabled={!dirty || saving}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} /> : null}
                      {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
                    </button>
                  </>
                )}
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
