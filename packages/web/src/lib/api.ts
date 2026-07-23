import type { BridgeEvent, EngineInfo, EngineSettings, PriceMap, Signal, SymbolRow } from '@csb/shared'

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

export async function fetchSymbols(): Promise<SymbolRow[]> {
  const r = await fetch('/api/symbols')
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
