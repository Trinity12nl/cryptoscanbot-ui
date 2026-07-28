import type { ReactNode } from 'react'

/**
 * Read-only renderers for the engine's raw settings values. The settings JSON is the contract
 * (PascalCase, arbitrary depth), so we render it generically: primitives as labelled rows, nested
 * objects as indented sub-sections, and arrays as chips or a stack of entries. This is the viewer
 * half of the settings migration - editing/write-back lands in a later phase, so nothing here writes.
 */

/** "ActivateExchangeName" -> "Activate Exchange Name"; leaves already-spaced labels alone. */
export function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const Bool = ({ value }: { value: boolean }) => (
  <span
    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
      value
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
    }`}
  >
    {value ? 'On' : 'Off'}
  </span>
)

const Chips = ({ items }: { items: unknown[] }) =>
  items.length === 0 ? (
    <span className="text-zinc-400 dark:text-zinc-600">(empty)</span>
  ) : (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <span
          key={i}
          className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {String(it)}
        </span>
      ))}
    </div>
  )

/** A single "label: value" row for a primitive setting. */
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(9rem,14rem)_1fr] items-center gap-x-4 gap-y-1 py-1">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 font-mono text-zinc-800 dark:text-zinc-100">{children}</span>
    </div>
  )
}

/** Render one key/value pair from a settings object, dispatching on the value's shape. */
function Entry({ name, value }: { name: string; value: unknown }) {
  const label = humanize(name)

  if (Array.isArray(value)) {
    const allPrimitive = value.every((v) => !isPlainObject(v) && !Array.isArray(v))
    if (allPrimitive) return <FieldRow label={label}><Chips items={value} /></FieldRow>
    return (
      <SubSection title={label}>
        {value.map((v, i) => (
          <SubSection key={i} title={`#${i + 1}`}>
            {isPlainObject(v) ? <ObjectFields obj={v} /> : <FieldRow label="" >{String(v)}</FieldRow>}
          </SubSection>
        ))}
      </SubSection>
    )
  }

  if (isPlainObject(value)) {
    return (
      <SubSection title={label}>
        <ObjectFields obj={value} />
      </SubSection>
    )
  }

  if (typeof value === 'boolean') return <FieldRow label={label}><Bool value={value} /></FieldRow>
  if (value == null || value === '') return <FieldRow label={label}><span className="text-zinc-400 dark:text-zinc-600">-</span></FieldRow>
  return <FieldRow label={label}>{String(value)}</FieldRow>
}

/** An indented, titled group - used for nested objects and array entries. */
export function SubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2 border-l border-zinc-200 pl-3 dark:border-zinc-800">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{title}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

/** Render every field of an object in its natural key order. */
export function ObjectFields({ obj, omit }: { obj: Record<string, unknown>; omit?: (key: string) => boolean }) {
  const keys = Object.keys(obj).filter((k) => !(omit?.(k) ?? false))
  if (keys.length === 0) return <p className="py-1 text-zinc-400 dark:text-zinc-600">Nothing to show.</p>
  return (
    <div className="text-xs">
      {keys.map((k) => (
        <Entry key={k} name={k} value={obj[k]} />
      ))}
    </div>
  )
}
