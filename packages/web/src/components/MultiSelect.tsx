import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  options: SelectOption[]
  value: readonly string[]
  onChange: (v: string[]) => void
  placeholder: string
}

// Ported from the old web app; string-valued (the oracle uses names, not ids).
export function MultiSelect({ options, value, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }

  const noun = placeholder.replace(/^All\s+/i, '')
  const label =
    value.length === 0 ? placeholder :
    value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? noun) :
    `${value.length} ${noun}`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative h-8 min-w-[130px] rounded-md border border-zinc-200 bg-white px-2.5 pr-7 text-left text-xs text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-zinc-500"
      >
        <span className={value.length === 0 ? 'text-zinc-400 dark:text-zinc-500' : ''}>{label}</span>
        <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-max min-w-full overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 flex w-full items-center gap-2.5 border-b border-zinc-100 px-3 py-1.5 text-left text-xs text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${value.length === 0 ? 'border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100' : 'border-zinc-300 dark:border-zinc-600'}`}>
              {value.length === 0 && <Check size={9} className="text-white dark:text-zinc-900" />}
            </span>
            All
          </button>
          {options.map((opt) => {
            const selected = value.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
              >
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${selected ? 'border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100' : 'border-zinc-300 dark:border-zinc-600'}`}>
                  {selected && <Check size={9} className="text-white dark:text-zinc-900" />}
                </span>
                <span className="flex-1">{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
