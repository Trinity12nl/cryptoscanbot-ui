# Handover: SignalR barometer / prices / market-indicators - bridge + web side

> Post-compact handover. The **C# scanner side is DONE, live-tested and committed** (avalonia repo,
> branch `feat/signalr-barometer-prices`, commit `20e0aa97`, local-only). This doc is the remaining
> work: consume the new SignalR broadcasts in **cryptoscanbot-ui** (bridge + web) and render them.
> Full design + the C# details: `tasks/todo-signalr-barometer-prices-dto.md`.

## What the C# scanner now emits (source of truth for the shapes)

All PascalCase on the wire (hub JSON `PropertyNamingPolicy = null`). Hub URL:
`http://localhost:5200/signalr/signals`. Everything is gated behind the scanner's `SignalREnabled`.

**Server -> client broadcasts (`conn.on(...)`):**

- `ReceiveSignal` -> `CryptoSignalDto` - already handled today.
- `ReceiveBarometer` -> `BarometerDto` (per quote, ~1/min + on connect):
  `{ Exchange, Quote, Barometer15m, Barometer30m, Barometer1h, Barometer4h, Barometer1d (float?),
     CalculatedAt (DateTime), Ready (bool), Progress (string) }`
- `ReceivePrices` -> `PriceSnapshotDto` (~every 4s + on connect):
  `{ Exchange, Date (DateTime), Prices (Dictionary<string,decimal>) }`  // symbolName -> price, e.g. "BTCUSDT" -> 65321.8
- `ReceiveMarketIndicators` -> `MarketIndicatorsDto` (~1/min + on connect):
  `{ Date (DateTime), Indicators: [ { Name (string), Value (decimal), Volume (double) } ] }`
  // 5 items: Market Cap Total, US Dollar Index, S&P 500, BTC Dominance, Fear and Greed index

**Client -> server request/response (`conn.invoke(...)`):**

- `GetBarometerGraph(quote, interval)` -> `BarometerGraphDto`:
  `{ Exchange, Quote, Interval, Ready (bool), Progress (string),
     Points: [ { Date (DateTime), Value (float) } ] }`  // ~7h of per-minute points, oldest first
  Invoke on connect, on reconnect, and whenever the user switches timeframe (1h / 4h / 1d).

**Loading state (already designed + verified):** while the scanner is still loading candles,
`Ready == false` and `Progress` is e.g. `"25 / 25 (XRPUSDT)"`. The UI must show a **pulsating skeleton**
(red/green bars) + the `Progress` label, and only swap in the real graph once `Ready == true`. Never
render a half-filled graph. Both the tip and the graph DTO carry `Ready` + `Progress`.

## Bridge work (`packages/bridge/`)

`src/signalr-source.ts` today: `SignalrSource` connects and handles only `ReceiveSignal` (emits signal
ids). Extend it:

- [ ] Add `conn.on('ReceiveBarometer' | 'ReceivePrices' | 'ReceiveMarketIndicators', ...)` handlers.
- [ ] Add `conn.invoke('GetBarometerGraph', quote, interval)` - called on connect, in the `onreconnected`
      / connect path, and on demand (timeframe switch request from the web).
- [ ] Translate PascalCase -> our camelCase and emit new `BridgeEvent`s.
- [ ] New `BridgeEvent` variants in `packages/shared/src/index.ts` (mirror the existing event union):
      `{ type: 'barometer', ... }` (tip), `{ type: 'barometerGraph', ... }` (pull result),
      `{ type: 'prices', prices: PriceMap }` (a `PriceMap` already exists), `{ type: 'marketIndicators', ... }`.
- [ ] **Stop the public ccxt `ticker-source.ts` when SignalR prices are live** (avoid double-feeding
      `PriceMap`). Prefer SignalR prices; fall back to the ccxt ticker only when the hub is not connected.
      See `hasEverConnected()` on `SignalrSource` for the "hub is authoritative" signal.
- [ ] The web needs a way to request a graph pull for a given interval - add a small request path
      (e.g. a WS message web->bridge, or expose interval and let the bridge pull on change). Simplest:
      bridge pulls all 3 (1h/4h/1d) on connect and re-pulls on reconnect; web asks for a specific one on switch.

Test any change against the running scanner with the probe: `pnpm --filter @csb/bridge probe:signalr`
(`packages/bridge/probe-signalr.mjs`) - it already exercises every event + the graph pull.

## Web work (`packages/web/src/`)

- [ ] **Barometer graph panel** (the scanner-header barometer): quote + interval (1h/4h/1d) selector,
      graph of the `barometerGraph` points, and the latest values. Pull on mount + on interval switch;
      append the per-minute `barometer` tip and drop the oldest point (7h sliding window). While
      `!ready`, show **pulsating skeleton candles** + the `progress` string ("loading... 25 / 25 (SYM)").
      Charting: the app already uses `lightweight-charts` for candles - reuse it, or a lightweight
      custom SVG for the small barometer sparkline.
- [ ] **Crypto Prices** panel - a curated subset (BTC/ETH/XRP/SOL/PAXG) from the `prices` map + volume.
- [ ] **Market Indicators** panel - the 5 `marketIndicators` values (display-only; F&G has no volume).
- [ ] **Change column** - once SignalR prices feed `PriceMap`, the existing Change column just works
      (it already consumes `PriceMap`); confirm it prefers SignalR over the ccxt ticker.

Panel -> data mapping is in `tasks/todo-signalr-barometer-prices-dto.md` ("The bigger picture: this is
the scanner header"). Screenshots of the C# scanner header are the visual target; Inge will steer the
look (cherry-pick from the old app rather than reinventing - see the "cherry-pick old UI" memory).

## Notes / gotchas carried over

- Prices cover the **fetched/loaded** symbol set (~40 on Bybit Spot), decided at scanner **startup** from
  the min-volume filter - NOT all exchange symbols. That's correct: it's exactly the symbols that can
  raise signals, so every displayed row has a price. Don't chase "why not all 418" - that's settled.
- To run the scanner with these broadcasts: launch the final build
  `CryptoScanBot-avalonia/CryptoScanner/bin/Debug/net8.0/osx-arm64/publish-signalr-final/CryptoScanBot`
  (Inge launches it; never run the scanner from the agent shell - macOS TCC SQLite). SignalR must be
  enabled in the scanner settings (port 5200).
- The C# branch is **local-only**; do NOT push it to Marius's remote without Inge's go-ahead.

## Review

(fill in once the bridge/web side is built)
