# SignalR reconciliation - adopt Marius's engine-side dashboard API

## Why

Marius independently built the same live-dashboard SignalR feature we did. His version is
already on `upstream/avalonia` (`0adb969f`, "SignalR: added GetBarometerGraph and other dashboard
stuff", Jul 27). Our engine-side work lives only on the local, unpushed branch
`feat/signalr-barometer-prices` (3 commits). Decision (Inge, 2026-07-29): **his implementation is
the base** - drop our C# commits and re-point our Node bridge to consume his API. The web UI barely
changes; the bridge is the translation layer.

Fun fact: both implementations independently named the graph RPC **`GetBarometerGraph(quote,
interval)`** - so that half already lines up.

## The two APIs side by side

### Live updates
- **His:** one combined push `ReceiveDashboardUpdate` (`DashboardUpdateDto`), fired by a **1-minute**
  timer in `SignalRService.OnDashboardTimerTick`. Payload = LatestBarometerPoint + BarometerValues +
  MarketIndicators + SymbolPrices + TickerStats.
- **Ours (bridge currently listens for):** four separate broadcasts - `ReceiveBarometer`,
  `ReceivePrices`, `ReceiveMarketIndicators`, `ReceiveTickers`.

### Graph
- **Both:** hub RPC `GetBarometerGraph(quote, interval)` - client pulls on connect / timeframe switch.
  (Our bridge already invokes exactly this in `signalr-source.ts:222`.)

## Field mapping: his DTOs -> our bridge wire types (`packages/bridge/src/signalr-dto.ts`)

| Our BridgeEvent (target)         | His source (in `DashboardUpdateDto`) | Notes / gaps |
|----------------------------------|--------------------------------------|--------------|
| `Tickers` {klineTickerCount, analyzeCount, signalCount} | `TickerStats` {KlineTickerCount, **ScannerExecuteCount**, **ScannerSignalCount**, ScannerPositionCount} | rename Execute->analyze, Signal->signal. **Bonus:** `ScannerPositionCount` (string) can fill our "Open positions" placeholder. |
| `MarketIndicators` [{name, value, volume}] | `MarketIndicators` [{Type, Symbol, **Name**, **Price**, Volume}] | Name->name, Price->value, Volume->volume (ignore Type/Symbol). |
| `PriceMap` {Prices: Record<name, number>} | `SymbolPrices` [{Symbol, Price, Volume}] | fold array -> record Symbol:Price. Volume unused (UI reads volume from the symbols list). |
| `Barometer` {m15, m30, h1, h4, d1, ready, progress} | `BarometerValues` {Barometer1h, Barometer4h, Barometer1d, BarometerTime} | **GAP:** no 15m/30m (-> null), **no Ready/Progress**. |
| barometer graph (RPC) {exchange, quote, interval, ready, progress, points:[{tMs, value}]} | `GetBarometerGraph` -> `BarometerGraphDto` {Quote, Interval, Points:[{**Time**, Value}]} | Point.Time->date; **no Exchange/Ready/Progress** (default ready=true, progress=''). |

## Gaps to raise with Marius (the coordination points)

1. **No `Ready` / `Progress` on the barometer.** Our UI shows a live "Loading candles N/M (SYMBOL)"
   line and flips the graph in the instant loading finishes (our commit `dcbd10dc`, and the barometer
   graph-appears-promptly fix #26 both depend on `Ready`/`Progress`). His DTOs omit both. Options:
   - (a) accept a plain loading skeleton with no progress text and a ~1-min-late graph, or
   - (b) ask Marius to add `Ready` + `Progress` to `BarometerValuesDto`/`BarometerGraphDto`
     (this is literally what our `dcbd10dc` did) - offer it back as a small PR.
2. **1-minute push cadence.** Readings/prices/tickers update once a minute; during candle load our
   version pushed ~every 2s. Ask whether he wants a faster tick (or a faster tick only while
   `ApplicationStatus == Running && !Ready`).
3. **Per-quote readings vs server-selected quote.** His push uses `SignalRService.SelectedQuote/
   SelectedInterval` - set **in-process by the Avalonia UI**. Our headless bridge can't set those, so
   the pushed `BarometerValues`/`LatestBarometerPoint` always reflect the *desktop app's* selected
   quote, not what our web user picked. The **graph** is fine (RPC takes params). For the 1h/4h/1d
   readings per selected quote we need either:
   - a new RPC `GetBarometerValues(quote)` (mirrors `GetBarometerGraph`), or
   - compute readings bridge-side from the graph points.
   Prefer asking Marius for the RPC - it's symmetric with what he already wrote.
4. **`LatestBarometerPoint`** (in the push) lets us append the newest point to the graph live instead
   of re-pulling. Nice-to-have; our current 5s/60s REST re-pull already works.

## Plan (bridge-only, one PR)

- [ ] **Drop our C# branch.** Confirm `feat/signalr-barometer-prices` (local, unpushed) is fully
      superseded by `upstream/avalonia@0adb969f`; delete it after the bridge cutover is verified.
      (Keep `fix/mac-build` - separate concern.)
- [x] **`signalr-dto.ts`:** added wire types for his DTOs (`DashboardUpdateWire`, `BarometerValuesWire`,
      his `MarketIndicatorWire`, `TickerStatsWire`, `BarometerGraphWire`) + `parseDashboardUpdate(w)`
      returning `{ barometer, marketIndicators, tickers }` per the mapping table. `parseBarometerGraph`
      now reads `Point.Time` and defaults Ready/Progress. **Deviation: prices are NOT parsed** - see the
      prices note below.
- [x] **`signalr-source.ts`:** replaced the four `conn.on('Receive*')` handlers with a single
      `conn.on('ReceiveDashboardUpdate', ...)` fanning the parsed pieces out to the existing
      `barometer/marketIndicators/tickers` listener seams (hybrid-source.ts + server.ts untouched). Kept
      the `GetBarometerGraph` invoke and the ReceiveSignal handler. Price seam kept but inert (documented).
- [x] **Ready/Progress fallback** until Marius adds them: pushed data is `ready=true` (the engine only
      pushes once `ApplicationStatus == Running`, verified at `SignalRService.OnDashboardTimerTick`),
      `progress=''`.
- [ ] **Verify end-to-end** against Marius's build (`publish-marius`): start the scanner (SignalR on) ->
      bridge connects -> `ReceiveDashboardUpdate` arrives -> barometer strip, indicators, tickers all
      populate; prices show (from the ccxt ticker); `GET /api/barometer-graph` returns points. Paste a
      screenshot / log line. **PENDING - needs Inge to run the binary.**
- [ ] **CHANGELOG** (TECH): bridge now consumes the engine's official `ReceiveDashboardUpdate` +
      `GetBarometerGraph` API (Marius' implementation) instead of our interim broadcasts.

## NEW GAP found during cutover (#5): SymbolPrices is info-bar-only, not the full price map

His `DashboardDataCollector.GetSymbolPrices` iterates only `Settings.ShowSymbolInformation` (a handful
of reference symbols: BTC/ETH/XRP/SOL/ADA-ish) - it is the *info-bar* price list, NOT the full
per-symbol map our OLD `PriceSnapshotDto` carried (which priced every loaded symbol). Our web shares one
`PriceMap` (PricesContext) between the header's 5-symbol "Crypto Prices" column AND the signals-table
"Change" column (`signal-columns.tsx` reads `prices[signal.symbol]` for every row). And `server.ts`
makes SignalR prices *replace* the ccxt ticker the moment they arrive (`signalrPricesLive=true` ->
`ticker.setEnabled(false)`). So routing his sparse `SymbolPrices` into the price seam would blank the
Change column for every symbol except the ~5 reference ones. **Decision: don't route his SymbolPrices;
keep the ccxt ticker as the price source (it already covers the header's 5 symbols and every scanned
symbol).** Regression-free, no server/hybrid change. To raise with Marius: if we want engine-sourced
prices for the whole grid later, we'd need a comprehensive price DTO (all loaded symbols) or keep prices
on ccxt permanently (fine for our read-only UI).

## Review (2026-07-29 - code done, live-verify pending)

- Fetched + fast-forwarded local `avalonia` to `0adb969f`, published his build to
  `CryptoScanBot-avalonia/CryptoScanner/bin/Debug/net8.0/osx-arm64/publish-marius/CryptoScanBot` (native
  arm64; all 3 Mac-build workarounds already fixed upstream). Our safety branch
  `feat/signalr-barometer-prices` (incl. `dcbd10dc`) kept untouched.
- Rewrote `signalr-dto.ts` + `signalr-source.ts` (this branch, not yet committed). `pnpm -r typecheck`
  green across all 5 packages. No eslint config in repo (lint is a no-op); typecheck is the gate.
- Confirmed against his source: event `ReceiveDashboardUpdate` (SignalRService.cs:160), PascalCase wire
  (`PropertyNamingPolicy = null`), `GetBarometerGraph` returns `{Quote, Interval, Points:[{Time,Value}]}`
  (no Exchange/Ready/Progress), push gated on `ApplicationStatus == Running`, no snapshot-on-connect (so
  first data lands on the next 1-min tick).
- **Gaps still to coordinate with Marius (Inge appt'd him):** #1 no Ready/Progress (loading text +
  prompt graph) - offer `dcbd10dc`; #2 1-min cadence (was ~2s while loading); #3 per-quote readings vs
  server-selected quote; #5 (new, above) SymbolPrices scope. #4 LatestBarometerPoint is used here to set
  the barometer `calculatedAtMs`.
- **NEXT: Inge runs `publish-marius` with SignalR on for live-verify, THEN CHANGELOG (TECH) + commit + PR.**

## Out of scope here
- The settings write-back `ApplySettings` (separate Phase 1, still to do WITH Inge).
- Any push to Marius's remote (his engine work is already upstream; ours gets dropped, not pushed).

## Review
(fill in after the bridge cutover)
