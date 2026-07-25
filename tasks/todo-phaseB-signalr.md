# Phase B - SignalR live link (investigation + plan)

## What Marius built (avalonia commit `9460dfca` "Added SignalR on port 5200")

Self-hosted **ASP.NET Core SignalR** hub embedded in the Avalonia GUI app.

- **Files:** `CryptoScanner.Core/SignalR/{SignalRService,CryptoSignalHub,CryptoSignalDto}.cs`,
  wired in `App.axaml.cs`, toggled in `Settings/SettingsGeneral.cs`, broadcast from `Signal/SignalCreate.cs`.
- **Transport:** Kestrel on `IPAddress.Loopback` (localhost only), hub path
  **`http://localhost:5200/signalr/signals`**. JSON protocol with `PropertyNamingPolicy = null`
  => **PascalCase** field names on the wire. CORS allow-any-origin + credentials.
- **Client-facing surface = exactly ONE server->client event:** `ReceiveSignal(CryptoSignalDto)`.
  The hub has **no callable methods** (only connect/disconnect logging). It is **push-only**.
- **When it fires:** in `SignalCreate` right after a signal is queued/saved
  (`GlobalData.SignalRService?.BroadcastSignal(signal)`). Only **new** signals from the moment of
  connection - **no history/backfill on connect**, no symbols, no settings, no price stream,
  no standalone barometer stream. Skipped in `IsEmulatorMode` (backtest).
- **Lifecycle:** started in `App.OnFrameworkInitializationCompleted` after the scanner session
  starts; stopped on exit; **stop on sleep / restart on resume** (power events). So a live hub
  connection is a genuine "engine is running right now" signal.

### Why it didn't appear on port 5200 on my Mac
It is **off by default**: `SignalREnabled = false` in `SettingsGeneral`. Must be enabled in the
engine settings JSON (`General.SignalREnabled = true`, `General.SignalRPort = 5200`) and the app
restarted. Also note it runs **only in the GUI app** - there is no separate headless host.

### The DTO (richer than the SQLite oracle!)
`CryptoSignalDto` (PascalCase): `Id, Exchange, Symbol, Interval, Side (lowercased), Strategy
(=StrategyText), SignalPrice (decimal), SignalVolume (double), OpenDate, CloseDate,
ExpirationDate, IsInvalid, EventText, SlPercentage, Last24HoursChange`
- **Plus per-signal snapshots the oracle does NOT expose:**
  `Barometer15m/30m/1h/4h/1d` (float) and `Trend15m/30m/1h/4h/1d` (string).
  These are the in-memory barometer/trend **at signal time** - not a live global stream.

## What this does and does NOT give Phase B

| Phase B goal | SignalR delivers? |
|---|---|
| **Real engine liveness (heartbeat)** | **YES** - a live hub connection == engine running now. Directly fixes the Phase-A `existsSync`-only "online" fudge. |
| **Low-latency new-signal push** | **YES** - event on creation, replaces the 1.5s SQLite poll for *new* signals. |
| **Per-signal barometer + multi-TF trend** | **YES** - in the DTO; a "goodie" not in the oracle. |
| **Live global barometer graph** | **NO** - only per-signal snapshots on signal creation. Would need a new hub method/stream from Marius. |
| **Live prices** | **NO** - keep the existing public-ticker feed (Phase A already does this well). |
| **Signal history / symbols / settings** | **NO** - stays on the SQLite oracle + settings JSON. |

**Conclusion: Phase B is a hybrid, not a replacement.** SQLite oracle stays the source of truth
for history/symbols/settings; SignalR is layered on top for (1) real liveness and (2) instant
new-signal push with the extra barometer/trend fields. This fits the `ScannerDataSource` seam:
the UI never changes.

## Proposed design (behind the existing seam - REPORT FIRST, do not implement yet)

1. **`@microsoft/signalr` client in the bridge** (new dep). New `SignalrSource` that connects to
   `http://localhost:5200/signalr/signals`, subscribes to `ReceiveSignal`, maps the PascalCase DTO
   -> our `Signal` (reuse `strategyNameFromSettingsKey` for `Strategy`; parse decimals; epoch-ms the
   dates). Auto-reconnect with backoff.
2. **Composite data source** (`HybridDataSource implements ScannerDataSource`): delegates
   `getSignals/getSymbols` to `SqliteDataSource` (history/symbols unchanged), and drives
   `subscribeSignals` from SignalR when connected, **falling back to the SQLite poll when the hub is
   down**. De-dupe by signal `Id` so a signal seen on both paths isn't doubled.
3. **Liveness upgrade:** `info().connected` becomes **hub-connection-based** (truly online only when
   the SignalR client is connected), with the DB-exists check as the fallback. This is the
   "real engine liveness" we deferred out of Phase A.
4. **New DTO fields:** extend `Signal` with optional `barometer{15m..1d}` + `trend{15m..1d}` so the
   UI can show per-signal barometer/trend when they arrive via SignalR (null when only the oracle
   has the row). Additive, backward-compatible.
5. **Config:** bridge flag `--signalr[=url]` / env, default off, so nothing changes unless the
   engine has the hub enabled. Document enabling `General.SignalREnabled` in the engine.
6. **Prices + barometer graph:** unchanged in this phase (prices via ticker feed; global barometer
   graph stays Phase-A/oracle). Flag a **follow-up ask to Marius**: add a periodic barometer/price
   broadcast (or a `GetSnapshot` hub method for backfill-on-connect) to fully retire the poll.

## Open questions for Inge / Marius
- [ ] OK to add `@microsoft/signalr` to the bridge and build the hybrid source (SQLite stays primary)?
- [ ] Want the **per-signal barometer + multi-TF trend** surfaced in the UI (new columns), or hold?
- [ ] Ask Marius for a **backfill-on-connect** method and/or a **periodic barometer/price** broadcast?
  Without it, the global barometer graph + live prices remain on the current (non-SignalR) paths.
- [ ] Confirm single-machine assumption (hub is loopback-only; UI+bridge+engine on the same Mac).

## Todo
### #1 - Hybrid SignalR source (DONE, in branch `feat/phaseB-signalr`)
- [x] Add `@microsoft/signalr` dep + `SignalrSource` (connect, map DTO, self-managed reconnect,
      graceful when hub absent).
- [x] `HybridDataSource` behind the `ScannerDataSource` seam: SQLite = payload/history/symbols;
      SignalR = liveness + instant-push trigger (`sqlite.pollNow()`). Single emit path (the oracle
      poll), so no de-dup needed. Barometer/trend snapshots stashed + merged by id.
- [x] Hub-based `info().connected` liveness (falls back to DB-exists when the hub is down).
- [x] Extend `Signal` with optional `barometer`/`trend` (SignalR-only) - plumbed through in #1.
- [x] Bridge opt-in via `CSB_SIGNALR=1` / `CSB_SIGNALR_URL` (default off) + `startBridgeDefault({ signalrUrl })`.
- [ ] **Manual test (Inge):** enable hub in engine (`General.SignalREnabled = true`, restart), start
      the bridge with `CSB_SIGNALR=1`, fire a signal - confirm instant push + "online" only when the
      hub is connected (kill the engine -> goes offline even though the DB file still exists).

### #2 - Surface per-timeframe barometer + trend in the UI (DONE)
- [x] Source barometer/trend from the **oracle** (they're stored in the Signal table: `Barometer15m..1d`
      TEXT, `Trend15m..1d` INTEGER) - so they show for all signals incl. history, in Phase A too. This
      made the SignalR DTO's copy redundant, so SignalrSource was simplified to liveness+trigger only.
- [x] Two compact columns (off by default, in the column picker): `Barometer` (coloured numbers per
      TF) and `Trend TF` (▲/▼ per TF), for 15m/30m/1h/4h/1d.

## Review - #1 + #2 (2026-07-25, branch `feat/phaseB-signalr`)

**#1 - SignalR hybrid source (bridge).**
- `packages/bridge/src/signalr-source.ts` (NEW): `@microsoft/signalr` client to the engine hub.
  Listens for the one `ReceiveSignal` event and uses only the id (a "signal fired" notification) -
  the oracle has all the payload. Self-managed reconnect loop covering both initial-connect failure
  (hub not up) and later drops; degrades silently when the hub is absent. `resolveSignalrUrl()` =
  env/opts opt-in, off by default.
- `packages/bridge/src/hybrid-source.ts` (NEW): `HybridDataSource implements ScannerDataSource`.
  Oracle stays source of truth for reads; on a SignalR event it calls `sqlite.pollNow()` for
  near-instant push. `info().connected` = live hub OR DB-exists fallback.
- `packages/bridge/src/sqlite-source.ts`: added public `pollNow()` (no-op until polling seeded).
- `packages/bridge/src/bootstrap.ts`: wraps the oracle in `HybridDataSource` when a SignalR URL is
  configured; otherwise unchanged Phase-A path. `index.ts` re-exports the new modules.

**#2 - barometer/trend, from the oracle + in the UI.**
- Discovery: the oracle `Signal` table already stores `Barometer15m..1d` (TEXT) and `Trend15m..1d`
  (INTEGER; C# `CryptoTrendIndicator` 1=up/2=down/0=Unknown). So they come from SQLite - covering
  history + Phase A - which made the SignalR DTO's copy redundant; SignalrSource was trimmed to
  liveness+trigger only (no payload mapping).
- `packages/shared/src/index.ts`: `Signal.barometer?/trend?` + `SignalBarometer`, `SignalTrend`,
  `TrendDir = 'up'|'down'`.
- `packages/bridge/src/sqlite-source.ts`: `SIGNAL_SELECT` + mapper read the 10 columns
  (`toBarometer`, `toTrend`, `trendDir`).
- `packages/web/src/components/signal-columns.tsx`: two off-by-default columns - `Barometer`
  (coloured number per TF) and `Trend TF` (▲/▼ per TF).

**Verified.** `pnpm -r typecheck` clean (4 pkgs); `@csb/web` production build OK; ggshield clean.
Runtime against the live default oracle:
- `CSB_SIGNALR=1`: boots, logs `Phase B: SignalR live link enabled -> .../signalr/signals`, hub
  absent -> reconnect loop runs without crashing, `GET /api/info` -> **HTTP 200** (`connected:true`
  via DB-exists fallback). No flag: no Phase B line, `/api/info` -> **HTTP 200** (identical to Phase A).
- `GET /api/signals` now returns e.g. `barometer:{m15:-0.08..d1:-1.00}`, `trend:{m15:"down"..d1:"up"}`.

**Not yet done (Inge / follow-ups):** real-hub end-to-end test (needs the C# engine with
`SignalREnabled=true` -> confirm instant push + "online" only while the hub is connected); a desktop
UI toggle (env opt-in only for now); asking Marius for backfill-on-connect + a periodic
barometer/price broadcast (task #3).

## Review pass - hardening (2026-07-25, self-review of the diff)

Fresh-eyes pass over the branch. **Found + fixed one genuine bug** that would have failed the
kill-the-engine test; everything else reviewed clean.

- **BUG (fixed): liveness never went offline while the DB file existed.** `HybridDataSource.info()`
  computed `connected = signalr.isConnected() || base.connected`. Killing the engine drops the hub
  (`isConnected()` -> false) but leaves the `.db` on disk (`base.connected` still true), so the OR
  kept it "online" - defeating Phase B's whole point. Fix: `SignalrSource.hasEverConnected()` (set on
  first successful connect); `info()` now uses the live hub as authoritative *once it has ever
  connected* (`hasEverConnected() ? isConnected() : base.connected`). So: engine with the hub, then
  killed -> **offline**; an engine that never turned the hub on -> DB-exists fallback = unchanged
  Phase A. Also added a `stopped` guard to `start()` (no dangling connection if started after close).
- Reviewed clean: reconnect loop (single retry timer, no pile-up; `onclose`/failed-`connect` don't
  double-schedule; no retry/callbacks after `close()` - listeners cleared before `conn.stop()`),
  `pollNow()` guard, the 10 oracle columns + `trendDir` mapping.
- Re-verified: typecheck (4 pkgs) + web prod build + ggshield clean; hub-absent `/api/info` -> 200
  `connected:true` (fallback preserved). The offline-on-hub-drop path needs the real hub -> Inge's test.
- Note for the real-hub test: `@microsoft/signalr` in Node negotiates then uses WebSocket; import +
  build + connect-attempt all run fine headless, but the *successful* WS transport is only provable
  against the running hub - watch for a `[signalr] connected to ...` log line during the test.

## Real-hub test session (2026-07-25, with Inge)

The engine hub is **off by default** (`SettingsGeneral.SignalREnabled=false`); flipped it to `true` in
`~/Library/Application Support/CryptoScanBot/CryptoScanBot-settings.json` (port 5200) while the scanner
was quit (it rewrites the file on exit). Inge launches the scanner herself - launching it from the
agent shell fails (macOS TCC: `SQLite disk I/O error` on the rw startup, leaves a hot `-journal`;
recovered cleanly on her next normal launch, no data loss). **WS transport confirmed working**: bridge
logged `[signalr] connected to http://localhost:5200/signalr/signals`, live signals + barometer/trend
flowed. Dev setup: bridge `CSB_BRIDGE_PORT=4320 CSB_SIGNALR=1`, web vite on 5319 with
`CSB_BRIDGE_URL=http://127.0.0.1:4320` (note: her web proxies to **4320**, not the 4319 default).

Two more bugs found + fixed live (commit `1cc14ba`):
- **Offline mis-reported as "No scanner database found".** The web banner keyed off `!info.connected`,
  but Phase B made `connected` mean "hub live" - so quitting the engine (offline) falsely claimed the
  DB was gone. Split into `EngineInfo.dbPresent` (file-exists, drives the banner) vs `connected`
  (liveness, drives the dot). SqliteDataSource sets both; HybridDataSource spreads `dbPresent` through.
- Fragile initial load (noted, NOT fixed): the web's `Promise.all([info,signals,prices,settings])` is
  all-or-nothing, so one transient 500 (e.g. during the engine's startup-sync write burst) blanks the
  whole history until reload. Worth loading history independently later - out of Phase B scope.

**Design decision (Inge, "leave it"):** when SignalR is enabled but the hub has never connected, keep
the DB-exists fallback (shows online) rather than forcing offline. Trade-off accepted: a bridge
(re)started while the engine is down shows green until the first hub connect.

Still pending: Inge's final green/red liveness confirmation (start scanner -> green, quit -> red + no
banner), then merge/tag; and **#3** (ask Marius for backfill-on-connect + periodic barometer/price).
