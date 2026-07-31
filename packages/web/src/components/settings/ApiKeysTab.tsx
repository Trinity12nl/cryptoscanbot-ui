import { useEffect, useState } from 'react'
import { Loader2, Check, Send } from 'lucide-react'
import type { AltradySettings, TelegramSettings } from '@csb/shared'
import {
  fetchTelegramSettings, saveTelegramSettings, sendTelegramTest,
  fetchAltradySettings, saveAltradySettings,
} from '../../lib/api'

/**
 * The "API keys" tab: Telegram + Altrady credentials. Unlike the other (draft-only) settings tabs,
 * this one drives the engine's OWN code over SignalR (the bridge's /api/telegram + /api/altrady
 * endpoints -> hub RPCs), so Save actually works. Secrets are write-only: the engine only tells us
 * whether a token/key is configured (masked), never the value, so the inputs stay blank and "leave
 * blank to keep" preserves the stored secret. Requires a live engine (the endpoints 404 without it).
 */

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-emerald-500" />
      <span>
        <span className="text-xs text-zinc-700 dark:text-zinc-200">{label}</span>
        {hint != null && <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">{hint}</span>}
      </span>
    </label>
  )
}

function SecretInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <label className="block max-w-md">
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
      <input
        type="password"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
    </label>
  )
}

const btnPrimary = 'inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost = 'inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800'

function SectionTitle({ children }: { children: string }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{children}</h4>
}

export function ApiKeysTab() {
  const [telegram, setTelegram] = useState<TelegramSettings | null>(null)
  const [altrady, setAltrady] = useState<AltradySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [available, setAvailable] = useState(true)

  // Telegram draft
  const [tgToken, setTgToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')
  const [tgEmoji, setTgEmoji] = useState(true)
  const [tgSend, setTgSend] = useState(false)
  const [tgSaving, setTgSaving] = useState(false)
  const [tgSaved, setTgSaved] = useState(false)
  const [tgError, setTgError] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok'>('idle')
  const [testError, setTestError] = useState<string | null>(null)

  // Altrady draft
  const [alKey, setAlKey] = useState('')
  const [alSecret, setAlSecret] = useState('')
  const [alSaving, setAlSaving] = useState(false)
  const [alSaved, setAlSaved] = useState(false)
  const [alError, setAlError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([fetchTelegramSettings(), fetchAltradySettings()])
      .then(([tg, al]) => {
        if (!alive) return
        if (tg == null && al == null) { setAvailable(false); return }
        if (tg) { setTelegram(tg); setTgEmoji(tg.emojiInTrend); setTgSend(tg.sendSignalsToTelegram) }
        if (al) setAltrady(al)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  async function saveTelegram() {
    setTgSaving(true); setTgError(null); setTgSaved(false)
    try {
      const next = await saveTelegramSettings({
        token: tgToken || undefined, chatId: tgChatId || undefined,
        emojiInTrend: tgEmoji, sendSignalsToTelegram: tgSend,
      })
      setTelegram(next)
      setTgToken(''); setTgChatId('') // secrets are write-only; clear after save
      setTgSaved(true); setTimeout(() => setTgSaved(false), 2500)
    } catch (e: unknown) {
      setTgError(e instanceof Error ? e.message : 'Save failed')
    } finally { setTgSaving(false) }
  }

  async function runTest() {
    setTestState('sending'); setTestError(null)
    try {
      const sent = await sendTelegramTest()
      if (!sent) { setTestState('idle'); setTestError('Not configured - save a token and chat id first.'); return }
      setTestState('ok'); setTimeout(() => setTestState('idle'), 3000)
    } catch (e: unknown) {
      setTestState('idle'); setTestError(e instanceof Error ? e.message : 'Test failed')
    }
  }

  async function saveAltrady() {
    setAlSaving(true); setAlError(null); setAlSaved(false)
    try {
      const next = await saveAltradySettings({ key: alKey || undefined, secret: alSecret || undefined })
      setAltrady(next)
      setAlKey(''); setAlSecret('')
      setAlSaved(true); setTimeout(() => setAlSaved(false), 2500)
    } catch (e: unknown) {
      setAlError(e instanceof Error ? e.message : 'Save failed')
    } finally { setAlSaving(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-zinc-500 dark:text-zinc-400">
        <Loader2 size={14} className="animate-spin" /> Loading API keys…
      </div>
    )
  }
  if (!available) {
    return (
      <p className="py-6 text-xs text-zinc-500 dark:text-zinc-400">
        {"API keys need a live engine connection. Start the scanner with SignalR enabled and reopen this tab."}
      </p>
    )
  }

  const canTest = (telegram?.hasToken ?? false) && (telegram?.hasChatId ?? false)

  return (
    <div className="space-y-8">
      {/* Telegram */}
      <section className="space-y-4">
        <SectionTitle>Telegram</SectionTitle>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {"Push new signals to a Telegram chat. Secrets are stored encrypted by the engine and never shown again."}
        </p>

        <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
          <p className="mb-1.5 font-medium text-zinc-700 dark:text-zinc-200">How to set up</p>
          <ol className="list-inside list-decimal space-y-1">
            <li>{"In Telegram open "}<a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline dark:text-emerald-400">@BotFather</a>{", send "}<code className="rounded bg-zinc-200 px-1 py-0.5 font-mono dark:bg-zinc-800">/newbot</code>{" and copy the bot token."}</li>
            <li>{"Get your chat id from "}<a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline dark:text-emerald-400">@userinfobot</a>{", or a group id (starts with -100…). Message your bot once first."}</li>
            <li>{"Paste both, turn on \"Send signals to Telegram\" and Save, then Send test message."}</li>
          </ol>
        </div>

        <SecretInput label="Bot token" value={tgToken} onChange={setTgToken}
          placeholder={telegram?.hasToken ? '•••••••• (configured - leave blank to keep)' : 'Paste bot token'} />
        <SecretInput label="Chat id" value={tgChatId} onChange={setTgChatId}
          placeholder={telegram?.hasChatId ? '•••••••• (configured - leave blank to keep)' : 'e.g. -1001234567890'} />

        <div className="space-y-2">
          <Toggle label="Send signals to Telegram" hint="When off, the bot stays configured but no signal messages are sent." value={tgSend} onChange={setTgSend} />
          <Toggle label="Emoji trend markers" hint="Off = plain words (bullish/bearish) instead of coloured circles." value={tgEmoji} onChange={setTgEmoji} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void saveTelegram()} disabled={tgSaving} className={btnPrimary}>
            {tgSaving ? <Loader2 size={12} className="animate-spin" /> : tgSaved ? <Check size={12} /> : null}
            {tgSaving ? 'Saving…' : tgSaved ? 'Saved' : 'Save Telegram'}
          </button>
          <button type="button" onClick={() => void runTest()} disabled={!canTest || testState === 'sending'}
            title={canTest ? undefined : 'Save a bot token and chat id first'} className={btnGhost}>
            <Send size={12} />
            {testState === 'sending' ? 'Sending…' : testState === 'ok' ? 'Sent' : 'Send test message'}
          </button>
          {tgError != null && <span className="text-[11px] text-red-600 dark:text-red-400">{tgError}</span>}
          {testError != null && <span className="text-[11px] text-red-600 dark:text-red-400">{testError}</span>}
        </div>
      </section>

      {/* Altrady */}
      <section className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <SectionTitle>Altrady</SectionTitle>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {"Altrady API credentials (used by the engine for order forwarding). Stored encrypted; write-only."}
        </p>

        <SecretInput label="API key" value={alKey} onChange={setAlKey}
          placeholder={altrady?.hasKey ? '•••••••• (configured - leave blank to keep)' : 'Paste API key'} />
        <SecretInput label="API secret" value={alSecret} onChange={setAlSecret}
          placeholder={altrady?.hasSecret ? '•••••••• (configured - leave blank to keep)' : 'Paste API secret'} />

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void saveAltrady()} disabled={alSaving} className={btnPrimary}>
            {alSaving ? <Loader2 size={12} className="animate-spin" /> : alSaved ? <Check size={12} /> : null}
            {alSaving ? 'Saving…' : alSaved ? 'Saved' : 'Save Altrady'}
          </button>
          {alError != null && <span className="text-[11px] text-red-600 dark:text-red-400">{alError}</span>}
        </div>
      </section>
    </div>
  )
}
