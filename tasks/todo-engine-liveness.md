# Engine liveness + exchange-switch push

Two parked header items. Both are about the header not reflecting the real engine state.

## Task 1 - Exchange switch not picked up  ✅ DONE
The bridge sent `info` only once, on WS connect. When the C# engine switches active exchange, the
header (`Engine <name>`) only updated after a manual page refresh.

- [x] Bridge polls `source.info()` every 5s and broadcasts `{type:'info'}` when the active exchange
      (or connected state) changes. Cheap - one indexed row. Cleared in close().

## Task 2 - "live" indicator / scanner-stopped warning  ⏸ DROPPED in Phase A
Goal was to show a warning when the engine is stopped (today "live" only means our bridge WS is up).

Blocker: Phase A (read-only DB) has NO reliable near-real-time heartbeat.
- `Exchange.LastTimeFetched` = symbol-list refresh, bumped only ~hourly (`ThreadLoadData.cs:216`).
- The oracle `CryptoScanBot.db` only bumps when a signal writes (can be quiet for over an hour).
- Candles go to a SEPARATE per-exchange DB (`Bybit Spot.db`), but that file is written only when the
  engine recomputes zones (`ZoneCandleEngine.SaveCandlesForSymbolInterval`) - irregular, multi-minute
  (observed a 7.5-min gap while actively scanning). The per-minute flush timer works in memory only.

So any mtime threshold either false-positives ("stopped" while running - seen with a 3-min threshold)
or is too sluggish to be useful. Decision (Inge): skip liveness in Phase A. It becomes trivial once
Marius' SignalR / headless host (Phase B) can push a real heartbeat.

## Review
- Shipped Task 1: `packages/bridge/src/server.ts` 5s info poll broadcasting `{type:'info'}` on
  exchange/connected change. No changes to the data contract (EngineInfo unchanged).
- Reverted all Task 2 work (EngineInfo.lastFetchMs, ENGINE_STALE_MS, isEngineLive, candleDbFreshness,
  Header liveness states) - back to the original `live` = WS-connected behaviour.
- Follow-up parked for Phase B: real engine liveness via SignalR heartbeat.

Found + fixed while testing the exchange switch (same PR):
- Active exchange came from the oracle's `LastTimeFetched DESC` guess, which lags a switch by up to
  an hour. Now sourced from settings `ActivateExchangeName` via `readInfo()` in server.ts.
- Symbol list was a cross-exchange union (Symbol.ExchangeName is a C# quirk = the symbol's own name).
  `getSymbols` now joins `Exchange` on `ExchangeId` and filters by the real name; the app fetches for
  the active exchange, refetches on switch, and polls every 60s so the filtered count self-corrects
  while the engine backfills volumes after a switch.
