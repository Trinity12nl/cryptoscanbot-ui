import * as signalR from '@microsoft/signalr'

/**
 * Phase B live link: a SignalR client that connects to the C# engine's hub
 * (avalonia `SignalRService`, default http://localhost:5200/signalr/signals) and listens for the
 * one event it broadcasts: `ReceiveSignal(CryptoSignalDto)`, fired the moment the engine creates a
 * signal.
 *
 * We use it for exactly two things (see HybridDataSource):
 *  1. REAL engine liveness - a live hub connection means the engine is running right now, which the
 *     Phase-A "the DB file exists" check could only guess at.
 *  2. A near-instant push trigger - on a ReceiveSignal we poke the SQLite source to poll immediately
 *     instead of waiting up to 1.5s for its next tick.
 *
 * We deliberately ignore the DTO's payload (barometer/trend/etc): the SQLite oracle stores all of it
 * and is the single source of truth, so we only need the "a signal just fired" notification.
 *
 * Robustness: the hub is off by default and only present when the engine has SignalREnabled=true, so
 * this must degrade gracefully. We manage our own reconnect loop; when the hub is absent we simply
 * stay disconnected and liveness falls back to the DB-exists check - nothing else breaks.
 */

/** The wire shape the engine sends (PascalCase). We only read the Id - the oracle has the rest. */
interface CryptoSignalDto {
  Id: number
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

export class SignalrSource {
  private conn: signalR.HubConnection | null = null
  private connected = false
  private everConnected = false
  private stopped = false
  private retryTimer: NodeJS.Timeout | null = null
  private readonly signalListeners = new Set<(id: number) => void>()
  private readonly stateListeners = new Set<(connected: boolean) => void>()

  constructor(private readonly url: string) {}

  isConnected(): boolean {
    return this.connected
  }

  /** true once the hub has connected at least once - i.e. the engine is known to expose the hub, so
   * a later disconnect genuinely means "engine gone" (vs. an engine that simply never had the hub on,
   * where we must not treat "never connected" as offline). Lets HybridDataSource decide when the hub
   * is authoritative for liveness. */
  hasEverConnected(): boolean {
    return this.everConnected
  }

  /** Build the connection and start the (self-managed) connect/reconnect loop. */
  start(): void {
    if (this.conn || this.stopped) return
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(this.url)
      .configureLogging(signalR.LogLevel.None)
      .build()
    this.conn = conn

    conn.on('ReceiveSignal', (dto: CryptoSignalDto) => {
      for (const cb of this.signalListeners) cb(dto.Id)
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
      this.everConnected = true
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

  /** Fires with the signal id on every ReceiveSignal broadcast. Returns an unsubscribe fn. */
  onSignal(cb: (id: number) => void): () => void {
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
