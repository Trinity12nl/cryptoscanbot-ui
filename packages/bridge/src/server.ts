import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { BridgeEvent, ScannerDataSource } from '@csb/shared'

/**
 * Local HTTP + WebSocket bridge. The UI (web or Electron) talks ONLY to this, never to the data
 * source directly - so swapping SqliteDataSource (Phase B) for an HttpDataSource against a headless
 * C# host (Phase A) changes nothing here or in the UI.
 *
 * REST:  GET /api/info | /api/signals?limit= | /api/symbols?exchange=
 * WS:    pushes { type:'signals', ... } as new signals land, and { type:'info', ... } on connect.
 */
export function startBridge(source: ScannerDataSource, port: number): { close: () => void } {
  const json = (res: ServerResponse, code: number, body: unknown) => {
    const s = JSON.stringify(body)
    res.writeHead(code, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    })
    res.end(s)
  }

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    void (async () => {
      try {
        if (url.pathname === '/api/info') return json(res, 200, await source.info())
        if (url.pathname === '/api/signals') {
          const limit = Number(url.searchParams.get('limit') ?? '200')
          return json(res, 200, await source.getSignals({ limit }))
        }
        if (url.pathname === '/api/symbols') {
          const exchange = url.searchParams.get('exchange') ?? undefined
          return json(res, 200, await source.getSymbols({ exchange }))
        }
        json(res, 404, { error: 'not found' })
      } catch (err: unknown) {
        json(res, 500, { error: err instanceof Error ? err.message : 'internal error' })
      }
    })()
  })

  const wss = new WebSocketServer({ server: http })
  const send = (ws: WebSocket, ev: BridgeEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev))
  }
  wss.on('connection', (ws) => {
    void source.info().then((info) => send(ws, { type: 'info', info }))
  })

  const unsubscribe = source.subscribeSignals((signals) => {
    const ev: BridgeEvent = { type: 'signals', signals }
    for (const ws of wss.clients) send(ws, ev)
  })

  http.listen(port, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`[bridge] listening on http://127.0.0.1:${port}`)
  })

  return {
    close: () => {
      unsubscribe()
      wss.close()
      http.close()
      source.close()
    },
  }
}
