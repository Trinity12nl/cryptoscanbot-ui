// Standalone SignalR probe - verifies the C# scanner's live dashboard broadcast WITHOUT the bridge/web
// UI. Run it while the scanner is running with SignalR enabled (port 5200).
//
//   cd cryptoscanbot-ui/packages/bridge
//   node probe-signalr.mjs                 # defaults to http://localhost:5200/signalr/signals
//   CSB_SIGNALR_PORT=5200 node probe-signalr.mjs
//   CSB_SIGNALR_URL=http://localhost:5200/signalr/signals node probe-signalr.mjs
//   CSB_PROBE_QUOTE=USDT CSB_PROBE_INTERVAL=1h node probe-signalr.mjs
//
// It connects, pulls GetBarometerGraph for a few timeframes, and then prints every live broadcast:
//  - ReceiveDashboardUpdate (Marius' combined dashboard push, ~1/min while the scanner is Running):
//    barometer readings (1h/4h/1d), latest barometer point, market indicators, info-bar symbol
//    prices, and ticker/scanner counters.
//  - ReceiveSignal (the moment a signal is created).
// Matches the engine API on avalonia `0adb969f` (DashboardUpdateDto + GetBarometerGraph). Read-only:
// it never sends anything that changes scanner state. Ctrl+C to stop.

import * as signalR from '@microsoft/signalr'

const port = Number(process.env.CSB_SIGNALR_PORT ?? 5200) || 5200
const url = process.env.CSB_SIGNALR_URL ?? `http://localhost:${port}/signalr/signals`

const QUOTE = process.env.CSB_PROBE_QUOTE ?? 'USDT'
const ts = () => new Date().toLocaleTimeString()
const num = (v) => (v == null ? ' -- ' : Number(v).toFixed(2).padStart(6))

const conn = new signalR.HubConnectionBuilder()
  .withUrl(url)
  .configureLogging(signalR.LogLevel.None)
  .build()

// ---- live broadcast handlers -------------------------------------------------

// The engine's combined dashboard push (DashboardUpdateDto). Each section is optional - the engine
// omits it when there is no active exchange / no data yet.
conn.on('ReceiveDashboardUpdate', (dto) => {
  const bv = dto.BarometerValues
  if (bv) {
    console.log(
      `[${ts()}] BAROMETER  ${bv.Quote}  ` +
      `1h=${num(bv.Barometer1h)} 4h=${num(bv.Barometer4h)} 1d=${num(bv.Barometer1d)}  ` +
      `time=${bv.BarometerTime}  Ready=${bv.Ready} Progress="${bv.Progress ?? ''}"`
    )
  }

  const lp = dto.LatestBarometerPoint
  if (lp) console.log(`[${ts()}] LATEST PT  ${new Date(lp.Time).toLocaleTimeString()} = ${num(lp.Value)}`)

  const inds = dto.MarketIndicators ?? []
  if (inds.length) {
    console.log(`[${ts()}] INDICATORS ${inds.map((i) => `${i.Name}=${i.Price}`).join('  |  ')}`)
  }

  const sp = dto.SymbolPrices ?? []
  if (sp.length) {
    const sample = sp.slice(0, 3).map((s) => `${s.Symbol}=${s.Price}`).join('  ')
    console.log(
      `[${ts()}] SYM PRICES ${sp.length} symbols   e.g. ${sample}   ` +
      `(info-bar reference symbols only; the bridge uses the ccxt ticker for the full price map)`
    )
  }

  const t = dto.TickerStats
  if (t) {
    console.log(
      `[${ts()}] TICKERS    kline=${t.KlineTickerCount} analyze=${t.ScannerExecuteCount} ` +
      `signal=${t.ScannerSignalCount} pos="${t.ScannerPositionCount}"`
    )
  }
})

conn.on('ReceiveSignal', (dto) => {
  console.log(
    `[${ts()}] SIGNAL     #${dto.Id ?? '?'} ${dto.Symbol ?? ''} ${dto.Interval ?? ''} ` +
    `${dto.Side ?? ''} ${dto.Strategy ?? ''}`.trimEnd()
  )
})

conn.onclose((err) => {
  console.log(`[${ts()}] connection closed${err ? ': ' + err : ''}`)
})

// ---- connect + pull ----------------------------------------------------------

async function pullGraph(quote, interval) {
  try {
    const g = await conn.invoke('GetBarometerGraph', quote, interval)
    const n = g.Points?.length ?? 0
    const first = n ? new Date(g.Points[0].Time).toLocaleTimeString() : '-'
    const last = n ? new Date(g.Points[n - 1].Time).toLocaleTimeString() : '-'
    const lastVal = n ? Number(g.Points[n - 1].Value).toFixed(2) : '-'
    console.log(
      `[${ts()}] GRAPH PULL ${g.Quote} ${g.Interval}  ` +
      `points=${n}  window=${first}..${last}  lastValue=${lastVal}  ` +
      `Ready=${g.Ready} Progress="${g.Progress ?? ''}"`
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
      `-> Is the scanner running WITH SignalR enabled on port ${port}? ` +
      `(General.SignalREnabled in CryptoScanBot-settings.json - there is no UI toggle.)`
    )
    process.exit(1)
  }
  console.log(`Connected. Pulling graph + waiting for live broadcasts (Ctrl+C to stop)...\n`)

  // Pull the full barometer graph for the usual timeframes, like the UI does on connect/switch.
  for (const interval of ['1h', '4h', '1d']) await pullGraph(QUOTE, interval)
}

main()
