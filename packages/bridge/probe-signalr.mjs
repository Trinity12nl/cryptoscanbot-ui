// Standalone SignalR probe - verifies the C# scanner's barometer/prices/market-indicators broadcast
// WITHOUT the bridge/web UI. Run it while the scanner is running with SignalR enabled (port 5200).
//
//   cd cryptoscanbot-ui/packages/bridge
//   node probe-signalr.mjs                 # defaults to http://localhost:5200/signalr/signals
//   CSB_SIGNALR_PORT=5200 node probe-signalr.mjs
//   CSB_SIGNALR_URL=http://localhost:5200/signalr/signals node probe-signalr.mjs
//
// It connects, prints the snapshot-on-connect messages, pulls GetBarometerGraph for a few timeframes,
// and then keeps printing every live broadcast (barometer tip ~1/min, prices ~4s, indicators ~1/min).
// Read-only: it never sends anything that changes scanner state. Ctrl+C to stop.

import * as signalR from '@microsoft/signalr'

const port = Number(process.env.CSB_SIGNALR_PORT ?? 5200) || 5200
const url = process.env.CSB_SIGNALR_URL ?? `http://localhost:${port}/signalr/signals`

const QUOTE = process.env.CSB_PROBE_QUOTE ?? 'USDT'
const ts = () => new Date().toLocaleTimeString()

const conn = new signalR.HubConnectionBuilder()
  .withUrl(url)
  .configureLogging(signalR.LogLevel.None)
  .build()

// ---- live broadcast handlers -------------------------------------------------

conn.on('ReceiveBarometer', (dto) => {
  const b = (v) => (v == null ? ' -- ' : Number(v).toFixed(2).padStart(6))
  console.log(
    `[${ts()}] BAROMETER  ${dto.Exchange} ${dto.Quote}  ` +
    `15m=${b(dto.Barometer15m)} 30m=${b(dto.Barometer30m)} 1h=${b(dto.Barometer1h)} ` +
    `4h=${b(dto.Barometer4h)} 1d=${b(dto.Barometer1d)}  ` +
    `Ready=${dto.Ready} Progress="${dto.Progress ?? ''}"`
  )
})

conn.on('ReceivePrices', (dto) => {
  const keys = Object.keys(dto.Prices ?? {})
  const sample = keys.slice(0, 3).map((k) => `${k}=${dto.Prices[k]}`).join('  ')
  console.log(`[${ts()}] PRICES     ${dto.Exchange}  ${keys.length} symbols   e.g. ${sample}`)
})

conn.on('ReceiveMarketIndicators', (dto) => {
  const items = (dto.Indicators ?? []).map((i) => `${i.Name}=${i.Value}`).join('  |  ')
  console.log(`[${ts()}] INDICATORS ${items}`)
})

conn.on('ReceiveSignal', (dto) => {
  console.log(`[${ts()}] SIGNAL     #${dto.Id} ${dto.Symbol} ${dto.Interval} ${dto.Side} ${dto.Strategy}`)
})

conn.onclose((err) => {
  console.log(`[${ts()}] connection closed${err ? ': ' + err : ''}`)
})

// ---- connect + pull ----------------------------------------------------------

async function pullGraph(quote, interval) {
  try {
    const g = await conn.invoke('GetBarometerGraph', quote, interval)
    const n = g.Points?.length ?? 0
    const first = n ? new Date(g.Points[0].Date).toLocaleTimeString() : '-'
    const last = n ? new Date(g.Points[n - 1].Date).toLocaleTimeString() : '-'
    const lastVal = n ? Number(g.Points[n - 1].Value).toFixed(2) : '-'
    console.log(
      `[${ts()}] GRAPH PULL ${g.Exchange} ${g.Quote} ${g.Interval}  ` +
      `Ready=${g.Ready} Progress="${g.Progress ?? ''}"  points=${n}  ` +
      `window=${first}..${last}  lastValue=${lastVal}`
    )
  } catch (err) {
    console.log(`[${ts()}] GetBarometerGraph(${quote},${interval}) failed: ${err?.message ?? err}`)
  }
}

async function main() {
  console.log(`Connecting to ${url} ...`)
  try {
    await conn.start()
  } catch (err) {
    console.error(
      `Could not connect: ${err?.message ?? err}\n` +
      `-> Is the scanner running WITH SignalR enabled on port ${port}? (Settings -> General -> SignalR)`
    )
    process.exit(1)
  }
  console.log(`Connected. Waiting for snapshot + live broadcasts (Ctrl+C to stop)...\n`)

  // Pull the full barometer graph for the usual timeframes, like the UI will on connect/switch.
  for (const interval of ['1h', '4h', '1d']) await pullGraph(QUOTE, interval)
}

main()
