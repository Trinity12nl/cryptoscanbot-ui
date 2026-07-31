import type { Barometer, BarometerGraph, BridgeEvent, EngineInfo, EngineSettings, PriceMap, RawSettings, Signal, SymbolRow } from '@csb/shared'

/**
 * The web app's ONLY dependency on the backend: the local bridge (same origin in dev via Vite proxy,
 * same paths in Electron). It does not know or care that the bridge currently reads a SQLite oracle -
 * when we move to a headless C# host (Phase B), this file is unchanged.
 */

export async function fetchInfo(): Promise<EngineInfo> {
  const r = await fetch('/api/info')
  if (!r.ok) throw new Error(`info ${r.status}`)
  return r.json() as Promise<EngineInfo>
}

export async function fetchSignals(limit = 200): Promise<Signal[]> {
  const r = await fetch(`/api/signals?limit=${limit}`)
  if (!r.ok) throw new Error(`signals ${r.status}`)
  return r.json() as Promise<Signal[]>
}

export async function fetchSymbols(exchange?: string): Promise<SymbolRow[]> {
  const url = exchange ? `/api/symbols?exchange=${encodeURIComponent(exchange)}` : '/api/symbols'
  const r = await fetch(url)
  if (!r.ok) throw new Error(`symbols ${r.status}`)
  return r.json() as Promise<SymbolRow[]>
}

export async function fetchPrices(): Promise<PriceMap> {
  const r = await fetch('/api/prices')
  if (!r.ok) throw new Error(`prices ${r.status}`)
  return r.json() as Promise<PriceMap>
}

/** Engine config (which strategies/sides/quote-coins are enabled). null when not readable. */
export async function fetchSettings(): Promise<EngineSettings | null> {
  const r = await fetch('/api/settings')
  if (!r.ok) throw new Error(`settings ${r.status}`)
  return r.json() as Promise<EngineSettings | null>
}

/** The engine's full settings JSON, verbatim (the source of truth for the settings editor). null when
 * not readable. Everything the editor doesn't render is preserved and passed back untouched on save. */
export async function fetchRawSettings(): Promise<RawSettings | null> {
  const r = await fetch('/api/settings/raw')
  if (!r.ok) throw new Error(`settings/raw ${r.status}`)
  return r.json() as Promise<RawSettings | null>
}

/** Pull the ~7h barometer graph for a quote+interval (Phase B / SignalR only). Returns null when the
 * bridge has no live engine link or the hub is not connected yet - the UI keeps its loading skeleton. */
export async function fetchBarometerGraph(quote: string, interval: string): Promise<BarometerGraph | null> {
  const r = await fetch(`/api/barometer-graph?quote=${encodeURIComponent(quote)}&interval=${encodeURIComponent(interval)}`)
  if (!r.ok) return null
  return r.json() as Promise<BarometerGraph>
}

/** Pull the current 1h/4h/1d barometer values for a quote (Phase B / SignalR only). The engine's push
 * only carries the desktop app's selected quote, so this RPC-backed endpoint fills in the values when
 * a web user picks a different quote. Returns null when there's no live engine link or the hub is down. */
export async function fetchBarometerValues(quote: string): Promise<Barometer | null> {
  const r = await fetch(`/api/barometer-values?quote=${encodeURIComponent(quote)}`)
  if (!r.ok) return null
  return r.json() as Promise<Barometer>
}

/** Subscribe to live bridge events over WebSocket, with auto-reconnect. Returns an unsubscribe fn. */
export function connectBridge(onEvent: (ev: BridgeEvent) => void, onStatus?: (up: boolean) => void): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | null = null

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onopen = () => onStatus?.(true)
    ws.onmessage = (e) => {
      // A message means the socket is up - also covers a race where onopen's status
      // update was clobbered by a previous (intentionally closed) socket in StrictMode.
      onStatus?.(true)
      try { onEvent(JSON.parse(e.data as string) as BridgeEvent) } catch { /* ignore */ }
    }
    ws.onclose = () => {
      // Only report "down" (and retry) on an UNEXPECTED close. An intentional close
      // from cleanup must not flip the status false and stomp the live connection.
      if (!closed) {
        onStatus?.(false)
        retry = setTimeout(open, 1500)
      }
    }
    ws.onerror = () => ws?.close()
  }
  open()

  return () => {
    closed = true
    if (retry) clearTimeout(retry)
    ws?.close()
  }
}
