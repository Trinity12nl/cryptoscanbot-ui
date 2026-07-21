import type { BridgeEvent, EngineInfo, Signal, SymbolRow } from '@csb/shared'

/**
 * The web app's ONLY dependency on the backend: the local bridge (same origin in dev via Vite proxy,
 * same paths in Electron). It does not know or care that the bridge currently reads a SQLite oracle -
 * when we move to a headless C# host (Phase A), this file is unchanged.
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
      try { onEvent(JSON.parse(e.data as string) as BridgeEvent) } catch { /* ignore */ }
    }
    ws.onclose = () => {
      onStatus?.(false)
      if (!closed) retry = setTimeout(open, 1500)
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
