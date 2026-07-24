import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EngineSettings } from '@csb/shared'
import { STRATEGY_NAMES } from '@csb/shared'
import { resolveDbPath, type DataLocation } from './sqlite-source.js'

/**
 * Reads the C# engine's settings JSON (next to the oracle DB) and normalises it to EngineSettings.
 * Read-only: the engine owns its config; we only surface it to drive the smart filters. Reflects the
 * ACTIVE exchange only (the settings file is the active engine's config).
 *
 * The engine keeps the enabled strategies/intervals per side under Signal.Long / Signal.Short (e.g.
 * Strategy: ["sbm1","stobb"], Interval: ["1m","3m","5m"]). We union both sides and map the strategy
 * keys (case-insensitively) to the display names our signals use (STRATEGY_NAMES).
 */
const STRATEGY_NAME_BY_LOWER = new Map(
  Object.values(STRATEGY_NAMES).map((n) => [n.toLowerCase(), n]),
)

/** Settings file lives beside the DB, e.g. .../CryptoScanBot/CryptoScanBot-settings.json. Derives
 * from the SAME resolved data location as the DB, so a custom `-f` folder is honoured for both. */
export function resolveSettingsPath(opts: DataLocation = {}): string {
  return join(dirname(resolveDbPath(opts)), 'CryptoScanBot-settings.json')
}

interface SideConfig { Strategy?: string[]; Interval?: string[] }
interface RawSettings {
  General?: { ActivateExchangeName?: string; RemoveSignalAfterxCandles?: number }
  Signal?: { Long?: SideConfig; Short?: SideConfig }
  QuoteCoins?: Record<string, { MinimalVolume?: number; FetchCandles?: boolean }>
}

function normalize(raw: RawSettings, lastChangedMs: number): EngineSettings {
  const long = raw.Signal?.Long ?? {}
  const short = raw.Signal?.Short ?? {}

  const stratKeys = new Set(
    [...(long.Strategy ?? []), ...(short.Strategy ?? [])].map((s) => s.toLowerCase()),
  )
  const enabledStrategies = [...stratKeys]
    .map((k) => STRATEGY_NAME_BY_LOWER.get(k))
    .filter((n): n is string => n != null)

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
  private mtimeMs = 0
  private timer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(s: EngineSettings) => void>()

  constructor(opts: DataLocation = {}) {
    this.path = resolveSettingsPath(opts)
  }

  /** Current settings, re-reading the file only when it has changed on disk. */
  get(): EngineSettings | null {
    try {
      if (!existsSync(this.path)) return null
      const mtime = statSync(this.path).mtimeMs
      if (mtime !== this.mtimeMs || this.cached == null) {
        const raw = JSON.parse(readFileSync(this.path, 'utf8')) as RawSettings
        this.cached = normalize(raw, mtime)
        this.mtimeMs = mtime
      }
      return this.cached
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[settings] read failed: ${err instanceof Error ? err.message : 'error'}`)
      return this.cached
    }
  }

  /** Poll the file mtime and notify listeners when the engine's settings change. */
  start(): void {
    if (this.timer) return
    let last = this.mtimeMs
    this.timer = setInterval(() => {
      const s = this.get()
      if (s && this.mtimeMs !== last) {
        last = this.mtimeMs
        for (const cb of this.listeners) cb(s)
      }
    }, 10_000)
  }

  subscribe(cb: (s: EngineSettings) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.listeners.clear()
  }
}
