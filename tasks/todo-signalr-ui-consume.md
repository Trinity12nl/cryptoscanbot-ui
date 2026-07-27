# Consume the SignalR barometer / prices / market-indicators broadcast (UI side)

Implements the handover in `todo-signalr-bridge-web.md`. Two PRs:

## PR 1 - shared types + bridge (mechanical, no visual design)

- [x] `packages/shared`: added UI-shaped DTOs `Barometer` (tip), `BarometerPoint`/`BarometerGraph`,
      `MarketIndicator`/`MarketIndicators`; `BridgeEvent` variants `barometer` + `marketIndicators`
      (prices already existed). Optional `ScannerDataSource` methods (Phase B only): subscribe +
      last-value getters for barometer/prices/marketIndicators, and `getBarometerGraph(quote,interval)`.
- [x] `packages/bridge/signalr-dto.ts` (new): PascalCase wire interfaces + parse -> camelCase.
- [x] `packages/bridge/signalr-source.ts`: `conn.on` handlers for ReceiveBarometer/ReceivePrices/
      ReceiveMarketIndicators (translate + cache + notify listeners); `getBarometerGraph` invoke;
      subscribe methods + last-value getters; caches cleared on disconnect.
- [x] `packages/bridge/hybrid-source.ts`: exposes the new optional ScannerDataSource surface.
- [x] `packages/bridge/ticker-source.ts`: `setEnabled(bool)` so the ccxt ticker stands down.
- [x] `packages/bridge/server.ts`: prefers SignalR prices over the ccxt ticker (stands down while the
      hub feeds prices, resumes on hub drop via broadcastInfo); broadcasts barometer + marketIndicators;
      replays last cached values on WS connect; REST `GET /api/barometer-graph?quote=&interval=`.
- [x] Typecheck clean across all 4 packages; bridge builds. Phase-A smoke test: `/api/prices` 200,
      `/api/info` 200, `/api/barometer-graph` -> 404 "no live engine link" (graceful, no regression).

## PR 1 Review

Bridge now consumes the C# hub's barometer/prices/market-indicators broadcasts behind the existing
`ScannerDataSource` seam - all Phase-B methods are optional, so Phase A (SQLite only) is untouched and
falls back to the ccxt ticker exactly as before. Price source is the hub when live (ticker stands down)
and the ccxt ticker otherwise; the switch is driven by the price-snapshot arrival (on) and the
info-poll seeing `signalrConnected === false` (off). New tab gets a full snapshot replay on WS connect.
Graph is a REST pull (`/api/barometer-graph`) so the web requests it per quote+interval.

**Phase-B end-to-end still needs a live-scanner test** (Inge launches the scanner; agent must not).
See "How to test Phase B" at the bottom.

## PR 2 - web panels (Inge steers the look)

- [ ] Barometer graph panel (quote + 1h/4h/1d selector, pulsating skeleton while `!ready` + progress).
- [ ] Crypto Prices panel (curated subset from the prices map).
- [ ] Market Indicators panel (5 values, display-only).
- [ ] Confirm the Change column prefers SignalR prices.

## How to test Phase B (bridge <-> live scanner)

1. Launch the scanner with SignalR on (Inge): the `publish-signalr-final` build, port 5200.
2. Start the bridge pointed at the hub:
   `cd packages/bridge && CSB_SIGNALR=1 CSB_BRIDGE_PORT=4399 pnpm start`
   (log should show `[bridge] Phase B: SignalR live link enabled` + `[signalr] connected`, and once
   prices arrive `[ticker] disabled (SignalR prices live)`).
3. In another terminal, run the bridge probe (tests the bridge's OWN REST + WS, one layer above the
   raw-hub `probe:signalr`):
   `CSB_BRIDGE_PORT=4399 pnpm --filter @csb/bridge probe:bridge`
   Expect: `/api/info signalrConnected=true`; `/graph 1h/4h/1d` returns `points=...` (or a pulsating
   `Ready=false` while still loading); WS `barometer` (with `ready`/`progress`), `marketIndicators`,
   and `prices` events. Prices should now be the hub's fetched/loaded set (~40), NOT the 576-symbol
   ccxt list - that switch is the proof the hub is authoritative.
4. Kill the scanner -> within ~5s the bridge logs `[ticker] enabled (hub prices unavailable)` and
   `/api/prices` falls back to the ccxt ticker (count jumps back up to the full ticker list).

## Review

(fill in after each PR)
