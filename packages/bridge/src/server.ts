import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { BridgeEvent, ScannerDataSource } from '@csb/shared'
import type { TickerSource } from './ticker-source.js'
import type { SettingsSource } from './settings-source.js'

// Minimal content types for the assets Vite emits - enough to serve the built web UI.
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Local HTTP + WebSocket bridge. The UI (web or Electron) talks ONLY to this, never to the data
 * source directly - so swapping SqliteDataSource (Phase A) for an HttpDataSource against a headless
 * C# host (Phase B) changes nothing here or in the UI.
 *
 * REST:  GET /api/info | /api/signals?limit= | /api/symbols?exchange= | /api/prices
 * WS:    pushes { type:'signals' } as new signals land, { type:'prices' } as the ticker updates,
 *        and { type:'info' } + a first { type:'prices' } on connect.
 */
export function startBridge(
  source: ScannerDataSource, ticker: TickerSource, port: number,
  opts: { staticDir?: string; settings?: SettingsSource } = {},
): { close: () => void } {
  const settingsSource = opts.settings ?? null
  const json = (res: ServerResponse, code: number, body: unknown) => {
    const s = JSON.stringify(body)
    res.writeHead(code, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    })
    res.end(s)
  }

  // Serve the built web UI (when packaged) so the app is same-origin: no CORS, no proxy, and the
  // UI's relative /api + /ws calls just work. SPA fallback: unknown paths return index.html.
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null
  const serveStatic = (res: ServerResponse, pathname: string): boolean => {
    if (!staticRoot) return false
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
    let file = join(staticRoot, rel)
    if (!file.startsWith(staticRoot)) return false // path traversal guard
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticRoot, 'index.html')
    if (!existsSync(file)) return false
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
    return true
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
        if (url.pathname === '/api/prices') return json(res, 200, ticker.getPrices())
        if (url.pathname === '/api/settings') return json(res, 200, settingsSource?.get() ?? null)
        if (serveStatic(res, url.pathname)) return
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

  // Heartbeat: ping every 25s and drop sockets that miss a pong. Keeps the connection alive
  // through proxy/NAT idle timeouts (the cause of "live then reconnecting") and reaps dead ones.
  const alive = new WeakSet<WebSocket>()
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue }
      alive.delete(ws)
      ws.ping()
    }
  }, 25_000)

  wss.on('connection', (ws) => {
    alive.add(ws)
    ws.on('pong', () => alive.add(ws))
    void source.info().then((info) => send(ws, { type: 'info', info }))
    send(ws, { type: 'prices', prices: ticker.getPrices() })
    const settings = settingsSource?.get()
    if (settings) send(ws, { type: 'settings', settings })
  })

  const unsubscribe = source.subscribeSignals((signals) => {
    const ev: BridgeEvent = { type: 'signals', signals }
    for (const ws of wss.clients) send(ws, ev)
  })

  const unsubscribePrices = ticker.subscribe((prices) => {
    const ev: BridgeEvent = { type: 'prices', prices }
    for (const ws of wss.clients) send(ws, ev)
  })

  const unsubscribeSettings = settingsSource?.subscribe((settings) => {
    const ev: BridgeEvent = { type: 'settings', settings }
    for (const ws of wss.clients) send(ws, ev)
  })

  http.listen(port, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`[bridge] listening on http://127.0.0.1:${port}`)
  })

  return {
    close: () => {
      clearInterval(heartbeat)
      unsubscribe()
      unsubscribePrices()
      unsubscribeSettings?.()
      wss.close()
      http.close()
      source.close()
      ticker.close()
      settingsSource?.close()
    },
  }
}
