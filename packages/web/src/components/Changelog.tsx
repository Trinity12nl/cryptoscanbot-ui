import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, ScrollText, X } from 'lucide-react'
import { CHANGELOG_VERSIONS, hasUnseenChangelog, markChangelogSeen } from '../lib/changelog'

// Category badge colours, keyed by the section label. Unknown labels fall back to TECH.
const BADGE_CLASS: Record<string, string> = {
  NEW: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  IMPROVED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  FIX: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  TECH: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
}

// Render inline **bold** and `code` spans from a bullet's text.
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      nodes.push(<strong key={key++} className="font-semibold text-zinc-900 dark:text-zinc-100">{tok.slice(2, -2)}</strong>)
    } else {
      nodes.push(<code key={key++} className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[0.85em] font-mono">{tok.slice(1, -1)}</code>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

// Split a bullet into a clickable title + collapsible body. Our entries lead with a
// bold summary ("**Title.** detail…"), so that is the title and the rest is the body.
// Fallback: the first sentence is the title when there is no leading bold.
function splitItem(text: string): { title: string; body: string } {
  const bold = /^\s*\*\*(.+?)\*\*\s*/.exec(text)
  if (bold != null) {
    const title = bold[1]!.replace(/[.:\s]+$/, '')
    return { title, body: text.slice(bold[0].length).trim() }
  }
  const dot = text.indexOf('. ')
  if (dot > 0) return { title: text.slice(0, dot), body: text.slice(dot + 2).trim() }
  return { title: text, body: '' }
}

function ChangelogItem({ text }: { text: string }) {
  const { title, body } = splitItem(text)
  const [open, setOpen] = useState(false)
  const expandable = body.length > 0

  return (
    <li className="text-sm">
      <button
        type="button"
        onClick={() => expandable && setOpen(o => !o)}
        className={`flex w-full items-start gap-1.5 text-left ${expandable ? 'cursor-pointer' : 'cursor-default'}`}
        aria-expanded={expandable ? open : undefined}
      >
        <ChevronRight
          size={14}
          className={`mt-0.5 shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-90' : ''} ${expandable ? '' : 'invisible'}`}
        />
        <span className="font-medium text-zinc-800 dark:text-zinc-100">{title}</span>
      </button>
      {expandable && open && (
        <p className="mt-1 ml-[22px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          {renderInline(body)}
        </p>
      )}
    </li>
  )
}

/** Header button (with an unseen dot) that opens the changelog in a modal. */
export function Changelog() {
  const [open, setOpen] = useState(false)
  const [unseen, setUnseen] = useState(() => hasUnseenChangelog())

  useEffect(() => {
    if (!open) return
    markChangelogSeen()
    setUnseen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="What's new"
        className="relative rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <ScrollText size={16} />
        {unseen && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <ScrollText size={16} className="text-emerald-500" />
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">What's new</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                title="Close"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-10 overflow-auto px-6 py-6">
              {CHANGELOG_VERSIONS.map(v => (
                <section key={v.version}>
                  <div className="mb-4 flex items-baseline gap-3">
                    <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{v.version}</h2>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">{v.date}</span>
                  </div>

                  <div className="space-y-5 border-l border-zinc-200 pl-5 dark:border-zinc-800">
                    {v.sections.map(sec => (
                      <div key={sec.label}>
                        <span className={`mb-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${BADGE_CLASS[sec.label] ?? BADGE_CLASS['TECH']}`}>
                          {sec.label}
                        </span>
                        <ul className="space-y-1.5">
                          {sec.items.map((item, i) => (
                            <ChangelogItem key={i} text={item} />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
