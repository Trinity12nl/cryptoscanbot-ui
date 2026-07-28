// Standalone BRIDGE probe - verifies the bridge's own output (one layer above probe-signalr.mjs).
// probe-signalr.mjs talks straight to the C# hub; THIS talks to the bridge's WS + REST, so it proves
// the new bridge code: hub -> camelCase BridgeEvents, price preference / ticker stand-down, snapshot
// replay on connect, and the REST barometer-graph pull.
//
// Run order:
//   1. Inge launches the scanner (SignalR on, port 5200).
//   2. Start the bridge pointed at the hub, on a test port:
//        cd packages/bridge && CSB_SIGNALR=1 CSB_BRIDGE_PORT=4399 pnpm start
//   3. In another terminal:
//        CSB_BRIDGE_PORT=4399 pnpm --filter @csb/bridge probe:bridge
//        (or: CSB_BRIDGE_PORT=4399 node probe-bridge.mjs)
//
// Read-only: it only reads REST + listens on the WS. Ctrl+C to stop.

import { WebSocket } from 'ws'

const port = Number(process.env.CSB_BRIDGE_PORT ?? 4399) || 4399
const httpBase = process.env.CSB_BRIDGE_HTTP ?? `http://127.0.0.1:${port}`
const wsUrl = process.env.CSB_BRIDGE_WS ?? `ws://127.0.0.1:${port}`
const QUOTE = process.env.CSB_PROBE_QUOTE ?? 'USDT'
const ts = () => new Date().toLocaleTimeString()

// ---- REST checks -------------------------------------------------------------

async function getJson(path) {
  const res = await fetch(`${httpBase}${path}`)
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function restChecks() {
  const info = await getJson('/api/info')
  console.log(
    `[${ts()}] REST /api/info    ${info.status}  exchange=${info.body?.exchange} ` +
    `signalrConnected=${info.body?.signalrConnected} engineSignalrEnabled=${info.body?.engineSignalrEnabled}`,
  )

  const raw = await getJson('/api/settings/raw')
  const groups = raw.body ? Object.keys(raw.body).join(', ') : ''
  console.log(`[${ts()}] REST /api/settings/raw ${raw.status}  groups=[${groups}]`)

  const prices = await getJson('/api/prices')
  const n = prices.body ? Object.keys(prices.body).length : 0
  const sample = prices.body
    ? Object.entries(prices.body).slice(0, 3).map(([k, v]) => `${k}=${v}`).join('  ')
    : ''
  console.log(`[${ts()}] REST /api/prices  ${prices.status}  ${n} symbols   e.g. ${sample}`)

  for (const interval of ['1h', '4h', '1d']) {
    const g = await getJson(`/api/barometer-graph?quote=${QUOTE}&interval=${interval}`)
    if (g.status !== 200) {
      console.log(`[${ts()}] REST /api/barometer-graph ${QUOTE} ${interval}  ${g.status}  ${g.body?.error ?? ''}`)
      continue
    }
    const pts = g.body?.points ?? []
    const first = pts.length ? new Date(pts[0].tMs).toLocaleTimeString() : '-'
    const last = pts.length ? new Date(pts[pts.length - 1].tMs).toLocaleTimeString() : '-'
    const lastVal = pts.length ? Number(pts[pts.length - 1].value).toFixed(2) : '-'
    console.log(
      `[${ts()}] REST /graph ${QUOTE} ${interval}  200  Ready=${g.body?.ready} ` +
      `Progress="${g.body?.progress ?? ''}"  points=${pts.length}  window=${first}..${last}  last=${lastVal}`,
    )
  }
}

// ---- WS live events ----------------------------------------------------------

function handleEvent(ev) {
  switch (ev.type) {
    case 'info':
      console.log(`[${ts()}] WS info        exchange=${ev.info?.exchange} signalrConnected=${ev.info?.signalrConnected}`)
      break
    case 'prices': {
      const keys = Object.keys(ev.prices ?? {})
      const sample = keys.slice(0, 3).map((k) => `${k}=${ev.prices[k]}`).join('  ')
      console.log(`[${ts()}] WS prices      ${keys.length} symbols   e.g. ${sample}`)
      break
    }
    case 'barometer': {
      const b = ev.barometer
      const f = (v) => (v == null ? ' -- ' : Number(v).toFixed(2).padStart(6))
      console.log(
        `[${ts()}] WS barometer   ${b.quote}  15m=${f(b.m15)} 30m=${f(b.m30)} 1h=${f(b.h1)} ` +
        `4h=${f(b.h4)} 1d=${f(b.d1)}  ready=${b.ready} progress="${b.progress}"`,
      )
      break
    }
    case 'marketIndicators': {
      const items = (ev.indicators?.indicators ?? []).map((i) => `${i.name}=${i.value}`).join('  |  ')
      console.log(`[${ts()}] WS indicators  ${items}`)
      break
    }
    case 'tickers': {
      const t = ev.tickers
      console.log(`[${ts()}] WS tickers     kline=${t.klineTickerCount} analyze=${t.analyzeCount} signals=${t.signalCount}`)
      break
    }
    case 'settings':
      console.log(`[${ts()}] WS settings    activeExchange=${ev.settings?.activeExchange}`)
      break
    case 'settingsRaw':
      console.log(`[${ts()}] WS settingsRaw groups=[${Object.keys(ev.settingsRaw ?? {}).join(', ')}]`)
      break
    case 'signals':
      console.log(`[${ts()}] WS signals     ${ev.signals?.length ?? 0} row(s)`)
      break
    default:
      console.log(`[${ts()}] WS ${ev.type}`)
  }
}

async function main() {
  console.log(`Bridge REST ${httpBase}  |  WS ${wsUrl}\n`)
  try {
    await restChecks()
  } catch (err) {
    console.error(
      `REST check failed: ${err?.message ?? err}\n` +
      `-> Is the bridge running on port ${port}?  (cd packages/bridge && CSB_SIGNALR=1 CSB_BRIDGE_PORT=${port} pnpm start)`,
    )
    process.exit(1)
  }

  console.log(`\n[${ts()}] connecting WS - waiting for snapshot + live events (Ctrl+C to stop)...\n`)
  const ws = new WebSocket(wsUrl)
  ws.on('open', () => console.log(`[${ts()}] WS connected`))
  ws.on('message', (data) => {
    try {
      handleEvent(JSON.parse(data.toString()))
    } catch {
      /* ignore non-JSON */
    }
  })
  ws.on('close', () => console.log(`[${ts()}] WS closed`))
  ws.on('error', (err) => console.error(`[${ts()}] WS error: ${err?.message ?? err}`))
}

main()
