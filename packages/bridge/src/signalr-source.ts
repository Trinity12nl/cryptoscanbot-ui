import * as signalR from '@microsoft/signalr'
import type { SignalBarometer, SignalTrend } from '@csb/shared'

/**
 * Phase B live link: a SignalR client that connects to the C# engine's hub
 * (avalonia `SignalRService`, default http://localhost:5200/signalr/signals) and listens for the
 * one event it broadcasts: `ReceiveSignal(CryptoSignalDto)`, fired the moment the engine creates a
 * signal.
 *
 * We use this for two things (see HybridDataSource):
 *  1. REAL engine liveness - a live hub connection means the engine is running right now, which the
 *     Phase-A "the DB file exists" check could only guess at.
 *  2. A near-instant push trigger - on a ReceiveSignal we poke the SQLite source to poll immediately
 *     instead of waiting up to 1.5s for its next tick.
 *
 * The DTO also carries per-signal barometer + multi-timeframe trend snapshots that the SQLite oracle
 * does NOT store; we surface those as a snapshot so they can be merged onto the signal later.
 *
 * Robustness: the hub is off by default and only present when the engine has SignalREnabled=true, so
 * this must degrade gracefully. We manage our own reconnect loop; when the hub is absent we simply
 * stay disconnected and liveness falls back to the DB-exists check - nothing else breaks.
 */

/** The wire shape the engine sends (PascalCase - the hub sets PropertyNamingPolicy = null). */
interface CryptoSignalDto {
  Id: number
  Barometer15m: number | null
  Barometer30m: number | null
  Barometer1h: number | null
  Barometer4h: number | null
  Barometer1d: number | null
  Trend15m: string | null
  Trend30m: string | null
  Trend1h: string | null
  Trend4h: string | null
  Trend1d: string | null
}

/** What we hand on from a ReceiveSignal event: the id plus the oracle-absent barometer/trend. */
export interface SignalrSignalSnapshot {
  id: number
  barometer: SignalBarometer
  trend: SignalTrend
}

const DEFAULT_SIGNALR_PORT = 5200

/** Resolve the hub URL from env/opts, or null when SignalR is not enabled.
 * `CSB_SIGNALR_URL` wins; else `CSB_SIGNALR` truthy enables the default localhost URL on
 * `CSB_SIGNALR_PORT` (default 5200). Off (null) unless explicitly enabled. */
export function resolveSignalrUrl(opts: { signalrUrl?: string } = {}): string | null {
  if (opts.signalrUrl) return opts.signalrUrl
  if (process.env.CSB_SIGNALR_URL) return process.env.CSB_SIGNALR_URL
  const flag = process.env.CSB_SIGNALR
  if (flag && flag !== '0' && flag.toLowerCase() !== 'false') {
    const port = Number(process.env.CSB_SIGNALR_PORT ?? DEFAULT_SIGNALR_PORT) || DEFAULT_SIGNALR_PORT
    return `http://localhost:${port}/signalr/signals`
  }
  return null
}

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

function toSnapshot(d: CryptoSignalDto): SignalrSignalSnapshot {
  return {
    id: d.Id,
    barometer: {
      m15: num(d.Barometer15m), m30: num(d.Barometer30m), h1: num(d.Barometer1h),
      h4: num(d.Barometer4h), d1: num(d.Barometer1d),
    },
    trend: {
      m15: str(d.Trend15m), m30: str(d.Trend30m), h1: str(d.Trend1h),
      h4: str(d.Trend4h), d1: str(d.Trend1d),
    },
  }
}

export class SignalrSource {
  private conn: signalR.HubConnection | null = null
  private connected = false
  private stopped = false
  private retryTimer: NodeJS.Timeout | null = null
  private readonly signalListeners = new Set<(s: SignalrSignalSnapshot) => void>()
  private readonly stateListeners = new Set<(connected: boolean) => void>()

  constructor(private readonly url: string) {}

  isConnected(): boolean {
    return this.connected
  }

  /** Build the connection and start the (self-managed) connect/reconnect loop. */
  start(): void {
    if (this.conn) return
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(this.url)
      .configureLogging(signalR.LogLevel.None)
      .build()
    this.conn = conn

    conn.on('ReceiveSignal', (dto: CryptoSignalDto) => {
      const snap = toSnapshot(dto)
      for (const cb of this.signalListeners) cb(snap)
    })
    // We drive reconnection ourselves (below) rather than withAutomaticReconnect, so the same loop
    // covers both an initial connect failure (hub not up yet) and a later drop.
    conn.onclose(() => {
      this.setConnected(false)
      this.scheduleRetry()
    })

    void this.connect()
  }

  private async connect(): Promise<void> {
    if (!this.conn || this.stopped) return
    try {
      await this.conn.start()
      this.setConnected(true)
      // eslint-disable-next-line no-console
      console.log(`[signalr] connected to ${this.url}`)
    } catch {
      this.setConnected(false)
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, 5000)
  }

  private setConnected(v: boolean): void {
    if (v === this.connected) return
    this.connected = v
    for (const cb of this.stateListeners) cb(v)
  }

  /** Fires on every ReceiveSignal broadcast. Returns an unsubscribe fn. */
  onSignal(cb: (s: SignalrSignalSnapshot) => void): () => void {
    this.signalListeners.add(cb)
    return () => { this.signalListeners.delete(cb) }
  }

  /** Fires when the hub connection goes up or down. Returns an unsubscribe fn. */
  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.stateListeners.add(cb)
    return () => { this.stateListeners.delete(cb) }
  }

  close(): void {
    this.stopped = true
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    this.signalListeners.clear()
    this.stateListeners.clear()
    const c = this.conn
    this.conn = null
    if (c) void c.stop().catch(() => { /* already down */ })
  }
}
