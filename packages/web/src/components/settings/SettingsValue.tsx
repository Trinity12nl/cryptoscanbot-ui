import { createContext, useContext, type ReactNode } from 'react'
import { Check } from 'lucide-react'

/**
 * Editable renderers for the engine's settings, drawn as an actual settings FORM: scalar fields become
 * text inputs, checkboxes (booleans) and multi-value lists, and nested objects become titled cards
 * (the scanner's grouped boxes). Controls ARE editable and update a local draft via {@link EditContext};
 * persisting that draft back to the engine lands in a later phase, so nothing here writes to disk yet.
 * The settings JSON is the contract (PascalCase, arbitrary depth), so the shape is inferred generically.
 */

export type Path = (string | number)[]

/** Provided by the viewer: called with a field's absolute path + its new value to update the draft. */
export const EditContext = createContext<((path: Path, value: unknown) => void) | null>(null)

/** "ActivateExchangeName" -> "Activate exchange name"; leaves already-spaced labels alone. */
export function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A scalar field is a primitive or an array of primitives - it renders on a single form row. */
function isScalarField(v: unknown): boolean {
  if (Array.isArray(v)) return v.every((x) => !isPlainObject(x) && !Array.isArray(x))
  return !isPlainObject(v)
}

/* ------------------------------------------------------------------ editable form controls ------ */

const fieldClass =
  'w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-mono text-[11px] text-zinc-800 ' +
  'outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 ' +
  'dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100'

/** Text/number input bound to the draft. `numeric` re-parses the entry to a number on change. */
function TextField({ value, path, numeric }: { value: string; path: Path; numeric: boolean }) {
  const onChange = useContext(EditContext)
  return (
    <input
      type="text"
      value={value}
      spellCheck={false}
      onChange={(e) => {
        const raw = e.target.value
        const next = numeric && raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw
        onChange?.(path, next)
      }}
      className={fieldClass}
    />
  )
}

/** Checkbox bound to the draft, drawn to match the scanner. */
function CheckField({ value, path }: { value: boolean; path: Path }) {
  const onChange = useContext(EditContext)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={value}
      onClick={() => onChange?.(path, !value)}
      className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
        value
          ? 'border-emerald-500 bg-emerald-500 text-white'
          : 'border-zinc-300 bg-white hover:border-emerald-400 dark:border-zinc-600 dark:bg-zinc-950'
      }`}
    >
      {value && <Check size={11} strokeWidth={3} />}
    </button>
  )
}

/** Multi-value list (symbol lists, intervals, ...) edited as one-per-line text. */
function ListField({ items, path }: { items: unknown[]; path: Path }) {
  const onChange = useContext(EditContext)
  const numeric = items.length > 0 && items.every((x) => typeof x === 'number')
  return (
    <textarea
      value={items.map((i) => String(i)).join('\n')}
      spellCheck={false}
      rows={Math.min(Math.max(items.length, 1), 6)}
      onChange={(e) => {
        const lines = e.target.value.split('\n').map((s) => s.trim()).filter((s) => s !== '')
        onChange?.(path, numeric ? lines.map((s) => Number(s)) : lines)
      }}
      className={`${fieldClass} resize-y leading-snug`}
    />
  )
}

/** Pick the right editable control for a scalar value. Booleans are handled by the row (checkbox). */
function ScalarControl({ value, path }: { value: unknown; path: Path }) {
  if (Array.isArray(value)) return <ListField items={value} path={path} />
  if (typeof value === 'number') return <TextField value={String(value)} path={path} numeric />
  if (value == null) return <TextField value="" path={path} numeric={false} />
  return <TextField value={String(value)} path={path} numeric={false} />
}

/* --------------------------------------------------------------------- rows, cards, groups ------ */

/** One form row: label on the left, control on the right (checkboxes sit left-aligned in that cell). */
function FieldRow({ label, value, path }: { label: string; value: unknown; path: Path }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)] items-center gap-x-4 py-1.5">
      <label className="truncate text-zinc-600 dark:text-zinc-300" title={label}>{label}</label>
      {typeof value === 'boolean' ? <CheckField value={value} path={path} /> : <ScalarControl value={value} path={path} />}
    </div>
  )
}

/** A titled card wrapping a group of fields - mirrors the scanner's labelled parameter boxes. */
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {title && (
        <header className="border-b border-zinc-100 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {title}
        </header>
      )}
      <div className="px-3.5 py-2">{children}</div>
    </section>
  )
}

/**
 * Render every field of an object as a form: scalars grouped into one card at the top, then each nested
 * object/array-of-objects as its own titled card below. `path` is the object's absolute path in the
 * draft (so edits map back correctly). `cardGrid` lays the group cards out two/three-up (Indicators tab).
 */
export function ObjectFields({
  obj,
  path = [],
  omit,
  cardGrid = false,
}: {
  obj: Record<string, unknown>
  path?: Path
  omit?: (key: string) => boolean
  cardGrid?: boolean
}) {
  const keys = Object.keys(obj).filter((k) => !(omit?.(k) ?? false))
  if (keys.length === 0) return <p className="text-xs text-zinc-400 dark:text-zinc-600">Nothing to show.</p>

  const scalarKeys = keys.filter((k) => isScalarField(obj[k]))
  const groupKeys = keys.filter((k) => !isScalarField(obj[k]))

  return (
    <div className="space-y-3 text-xs">
      {scalarKeys.length > 0 && (
        <Card>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {scalarKeys.map((k) => (
              <FieldRow key={k} label={humanize(k)} value={obj[k]} path={[...path, k]} />
            ))}
          </div>
        </Card>
      )}

      {groupKeys.length > 0 && (
        <div className={cardGrid ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}>
          {groupKeys.map((k) => (
            <Card key={k} title={humanize(k)}>
              <GroupBody value={obj[k]} path={[...path, k]} />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/** The body of a card: a nested object, or an array of objects rendered as numbered mini-cards. */
function GroupBody({ value, path }: { value: unknown; path: Path }) {
  if (isPlainObject(value)) return <ObjectFields obj={value} path={path} />
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-zinc-400 dark:text-zinc-600">(empty)</p>
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              #{i + 1}
            </div>
            {isPlainObject(v) ? <ObjectFields obj={v} path={[...path, i]} /> : <ScalarControl value={v} path={[...path, i]} />}
          </div>
        ))}
      </div>
    )
  }
  return <ScalarControl value={value} path={path} />
}
