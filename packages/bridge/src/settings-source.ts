import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EngineSettings, RawSettings } from '@csb/shared'
import { strategyNameFromSettingsKey } from '@csb/shared'
import { resolveDbPath, type DataLocation } from './sqlite-source.js'

/**
 * Reads the C# engine's settings JSON (next to the oracle DB) and normalises it to EngineSettings.
 * Read-only: the engine owns its config; we only surface it to drive the smart filters. Reflects the
 * ACTIVE exchange only (the settings file is the active engine's config).
 *
 * The engine keeps the enabled strategies/intervals per side under Signal.Long / Signal.Short (e.g.
 * Strategy: ["bbma.omni","stobb"], Interval: ["1m","3m","5m"]). We union both sides and map the
 * strategy keys to the display names our signals use via `strategyNameFromSettingsKey` - which
 * handles the engine's dotted keys ("bbma.omni") and aliases ("dlz" -> DominantLevel).
 */

/** Settings file lives beside the DB, e.g. .../CryptoScanBot/CryptoScanBot-settings.json. Derives
 * from the SAME resolved data location as the DB, so a custom `-f` folder is honoured for both. */
export function resolveSettingsPath(opts: DataLocation = {}): string {
  return join(dirname(resolveDbPath(opts)), 'CryptoScanBot-settings.json')
}

interface SideConfig { Strategy?: string[]; Interval?: string[] }
/** The narrow slice of the settings file that `normalize` reads (the rest is passed through raw). */
interface SettingsShape {
  General?: {
    ActivateExchangeName?: string; RemoveSignalAfterxCandles?: number
    SignalREnabled?: boolean; SignalRPort?: number
  }
  Signal?: { Long?: SideConfig; Short?: SideConfig }
  QuoteCoins?: Record<string, { MinimalVolume?: number; FetchCandles?: boolean }>
  ShowSymbolInformation?: string[]
}

function normalize(raw: SettingsShape, lastChangedMs: number): EngineSettings {
  const long = raw.Signal?.Long ?? {}
  const short = raw.Signal?.Short ?? {}

  const stratKeys = new Set([...(long.Strategy ?? []), ...(short.Strategy ?? [])])
  const enabledStrategies = [...new Set(
    [...stratKeys]
      .map((k) => strategyNameFromSettingsKey(k))
      .filter((n): n is string => n != null),
  )]

  const enabledIntervals = [...new Set([...(long.Interval ?? []), ...(short.Interval ?? [])])]

  const quoteCoins = Object.entries(raw.QuoteCoins ?? {}).map(([name, q]) => ({
    name,
    minVolume: Number(q?.MinimalVolume ?? 0),
    active: q?.FetchCandles === true,
  }))

  return {
    activeExchange: raw.General?.ActivateExchangeName ?? null,
    enabledStrategies,
    enabledIntervals,
    sides: {
      long: (long.Strategy?.length ?? 0) > 0,
      short: (short.Strategy?.length ?? 0) > 0,
    },
    quoteCoins,
    showSymbolInformation: raw.ShowSymbolInformation ?? [],
    removeSignalAfterCandles: Number(raw.General?.RemoveSignalAfterxCandles ?? 0),
    lastChangedMs: Math.round(lastChangedMs),
    // Only the scan-relevant fields (raw, so a strategy like baba that we don't map is still seen).
    // Excludes the engine's bookkeeping writes that bump the file mtime without a real config change.
    configSignature: JSON.stringify({
      ls: long.Strategy ?? [], li: long.Interval ?? [],
      ss: short.Strategy ?? [], si: short.Interval ?? [],
      q: Object.entries(raw.QuoteCoins ?? {}).map(([n, c]) => [n, c?.MinimalVolume ?? 0, c?.FetchCandles === true]),
      ex: raw.General?.ActivateExchangeName ?? null,
      rm: raw.General?.RemoveSignalAfterxCandles ?? 0,
    }),
  }
}

export class SettingsSource {
  private readonly path: string
  private cached: EngineSettings | null = null
  private cachedRaw: RawSettings | null = null
  private mtimeMs = 0
  private timer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(s: EngineSettings) => void>()
  private readonly rawListeners = new Set<(s: RawSettings) => void>()

  constructor(opts: DataLocation = {}) {
    this.path = resolveSettingsPath(opts)
  }

  /** Re-read + re-parse the file when its mtime changed, refreshing both the normalized view and the
   * verbatim raw object. Returns true when a fresh parse happened. */
  private refresh(): boolean {
    if (!existsSync(this.path)) return false
    const mtime = statSync(this.path).mtimeMs
    if (mtime === this.mtimeMs && this.cached != null) return false
    const raw = JSON.parse(readFileSync(this.path, 'utf8')) as RawSettings
    this.cachedRaw = raw
    this.cached = normalize(raw as SettingsShape, mtime)
    this.mtimeMs = mtime
    return true
  }

  /** Current settings (normalized filter view), re-reading the file only when it changed on disk. */
  get(): EngineSettings | null {
    try {
      this.refresh()
      return this.cached
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[settings] read failed: ${err instanceof Error ? err.message : 'error'}`)
      return this.cached
    }
  }

  /** The engine's settings JSON parsed VERBATIM (PascalCase, whole object) - the source of truth the
   * settings editor works on. Re-read only when the file changed on disk. Null if missing/unreadable. */
  getRaw(): RawSettings | null {
    try {
      this.refresh()
      return this.cachedRaw
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[settings] raw read failed: ${err instanceof Error ? err.message : 'error'}`)
      return this.cachedRaw
    }
  }

  /** The engine's OWN SignalR config, read straight from its settings JSON (the half of the live link
   * we don't control). enabled=null when the file is missing/unreadable. Read-only. */
  getEngineSignalr(): { enabled: boolean | null; port: number | null } {
    try {
      if (!existsSync(this.path)) return { enabled: null, port: null }
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as SettingsShape
      return { enabled: raw.General?.SignalREnabled ?? null, port: raw.General?.SignalRPort ?? null }
    } catch {
      return { enabled: null, port: null }
    }
  }

  /** Poll the file mtime and notify listeners when the engine's settings change. Fires both the
   * normalized (filter) listeners and the raw (settings-editor) listeners off the same read. */
  start(): void {
    if (this.timer) return
    let last = this.mtimeMs
    this.timer = setInterval(() => {
      const s = this.get()
      if (s && this.mtimeMs !== last) {
        last = this.mtimeMs
        for (const cb of this.listeners) cb(s)
        const raw = this.cachedRaw
        if (raw) for (const cb of this.rawListeners) cb(raw)
      }
    }, 10_000)
  }

  subscribe(cb: (s: EngineSettings) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  /** Notified with the verbatim raw settings object whenever the file changes on disk. */
  subscribeRaw(cb: (s: RawSettings) => void): () => void {
    this.rawListeners.add(cb)
    return () => { this.rawListeners.delete(cb) }
  }

  close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.listeners.clear()
    this.rawListeners.clear()
  }
}
