# Cold-start & headless-engine readiness

Forward-looking analysis (2026-07-30): what happens when a user launches the *packaged* product
(UI + an engine) for the **first time**, with an empty/absent database and nothing loaded yet.
Written after the SignalR dashboard cutover (v0.8.11-0.8.15). Analysis only - **no code changed**.

> Grounding fact: today the desktop app does **NOT** bundle or launch any engine. It runs only the
> bridge in-process and assumes the user starts the C# CryptoScanBot separately, pointing the bridge
> at that engine's data folder (`-f "datafolder"`) + its SignalR hub on `localhost:5200`
> (`packages/desktop/src/main.ts:19-21,103,132`; package description: "runs the bridge in-process and
> shows the CryptoScanBot UI"). A "complete package incl. a headless engine" is a **future** goal.

---

## 1. Cold-start behaviour (the good news)

During the engine's **`Initializing`** phase the dashboard SignalR push fires **every 2 seconds**, NOT
the 1/minute cadence. The 1-minute throttle only applies once `ApplicationStatus == Running`:
- `SignalRService.cs:93` - timer ticks every `FromSeconds(2)`.
- `SignalRService.cs:162-166` - only when `Running` does it skip ticks to keep a `FromMinutes(1)`
  cadence (`_lastRunningPushUtc`). While Initializing, every 2s tick broadcasts.

And `BarometerValues` (incl. `Ready`/`Progress`) is filled **unconditionally, before the
`ActiveExchange == null` early-return** (`DashboardDataCollector.cs:50-53` / `GetBarometerValues`
sets `Ready = ApplicationStatus == Running`, `Progress = CandleProgressText`).

Result on first run:
- The header immediately shows the pulsating **"Loading candles... N/M (SYMBOL)"** and flips to the
  real barometer the instant loading finishes.
- Our bridge caches each push (`signalr-source.ts` `lastMarketIndicators`/`lastTickers`/
  `lastBarometerByQuote`) and **replays a snapshot to every newly-connected tab** (`server.ts:151-157`).
- So cold start does **NOT** suffer the ~1-minute blank we saw earlier - that was specifically a
  **bridge restart while the engine was already `Running`** (empty cache + next push up to a minute
  away). See [[project-signalr-broadcast]].

---

## 2. Rough edges on first run (minor, worth polishing)

**(a) Signals grid is empty until the first signal is written.** SQLite is the source of truth for
signals; on a genuine first run the `Signal` table is empty until the engine computes + persists the
first one (can be a while after candles finish). The grid just renders empty.
- Fix: a "Waiting for the first signals..." empty-state (distinct from a filtered-to-nothing state),
  shown when the hub is connected and there are simply no rows yet.

**(b) `NoDataBanner` can flash a false "database empty / not found".** `App.tsx` `emptyDb` is only
guarded by `everHadData` + `dbPresent` + `loaded`. In the window before the engine has created the DB
/ written the symbol list, the amber banner ("No scanner database found" / "The scanner database is
empty") can appear even though the engine is right there, just booting.
- Fix: suppress the banner while the SignalR hub is **connected** AND the engine is **`Initializing`**
  (a live hub means "engine present, still loading", not "wrong folder"). Needs an engine-status
  signal on `EngineInfo` (see note under 4.3).

**(c) Barometer-graph pull 503s until candles exist.** `/api/barometer-graph` returns 503 and the UI
keeps its pulsating skeleton (`server.ts:107-110`). Correct as-is - no change.

---

## 3. THE BIG ONE - market indicators are not produced by the engine core

The Market Indicators strip (Market Cap Total, US Dollar Index, S&P 500, BTC Dominance, Fear & Greed)
is fetched and registered by the **Avalonia UI project**, not `CryptoScanner.Core`:
- `CryptoScanner/Services/TradingViewService.cs:41,48` calls
  `DashboardDataCollector.SetMarketIndicator(...)`.
- The *list of what to fetch* (`TvSymbols`) is built in a UI ViewModel
  (`CryptoScanner/ViewModels/DashBoardInformationViewModel.cs:360-362`) and forwarded to the service;
  DI registration is in `CryptoScanner/MyServices.cs:40`; lifecycle is tied to
  `MainWindowViewModel` / `MainWindow.axaml.cs`.
- The fetchers live in the UI project too: `CryptoScanner/TradingView/TradingViewSymbolExtractor.cs`
  and `CryptoScanner/TradingView/FearAndGreedIndexExtractor.cs`.
- Core confirms the split: `CryptoScanner.Core/Core/ThreadLoadData.cs:264` -
  `"Diverse informatie tickers (moved to TradingViewService)"`.

**Consequence:** in a **Core-only headless host**, nothing ever calls `SetMarketIndicator`, so
`DashboardUpdate.MarketIndicators` is always empty -> **the indicators strip is permanently blank**.
Everything else (barometer, tickers, prices, signals, candle-load progress) still works, because
those come from Core / ccxt. In `DashboardDataCollector.CollectUpdate`, `MarketIndicators` is only
filled past the `if (exchange == null) return dto;` guard anyway, from the (UI-populated) static list.

### Decision table - what "headless engine" means drives everything

| Model | Market indicators | Cost / risk |
|---|---|---|
| **Bundle the full CryptoScanner app, run windowless/background** | ✅ work **IF** that startup path calls `TradingViewService.Start()` and populates `TvSymbols`. Today both are tied to the window/dashboard ViewModel, so a no-window launch may skip them - **must verify**. | Lowest engine work; ships Avalonia + its deps; need a headless/hidden-window launch mode + confirm the indicator service starts without a shown window. |
| **Core-only headless host** | ❌ blank unless ported | Cleanest long-term runtime, but **must port** `TradingViewSymbolExtractor` + `FearAndGreedIndexExtractor` + the `TvSymbols` config into Core and start them from the Core host. More upfront C# work (and it's Marius' repo). |

Either way this is an **engine/packaging decision that only Inge (with Marius) can make** - it
determines whether the header is complete in production and how much C# porting is needed.

---

## 4. Recommended fixes, in priority order

### 4.1 Engine `OnConnectedAsync` snapshot (keystone; small PR to Marius - needs go-ahead)
Push the current dashboard to the connecting client immediately, instead of making it wait for the
next timer tick:
```csharp
// CryptoScanner.Core/SignalR/CryptoSignalHub.cs, in OnConnectedAsync (before base call returns)
await Clients.Caller.SendAsync("ReceiveDashboardUpdate",
    DashboardDataCollector.CollectUpdate(/* SelectedQuote */, /* SelectedInterval */));
```
Makes **every** connect instant: cold-start races, a warm engine already `Running` when the app
opens, user reloads, and the bridge's own auto-reconnect. Mirrors the existing `GetBarometerGraph`
pull pattern. (The hub needs access to the selected quote/interval - `SignalRService` already holds
`SelectedQuote`/`SelectedInterval`; wire the hub to read them.)
- **Blocked on:** nothing technically, but hold the PR until 4.2 is decided (if indicators stay
  UI-only, this snapshot still helps barometer/tickers, just not indicators on a Core-only host).

### 4.2 Decide the headless model, then (if Core-only) port the indicator pipeline into Core
- Pick **bundle-windowless** vs **Core-only** (section 3 table).
- If Core-only: port `TradingViewSymbolExtractor` + `FearAndGreedIndexExtractor` + the `TvSymbols`
  default config into `CryptoScanner.Core`, and start them from the headless host so
  `SetMarketIndicator` runs without the Avalonia UI.
- If bundle-windowless: verify `TradingViewService.Start()` + `TvSymbols` population happen on a
  no-window launch; if not, add a headless startup hook.
- **This is the gating decision** - it determines 4.1's full value and all indicator behaviour.

### 4.3 UI polish (our repo, no engine dependency except a status flag)
- "Waiting for the first signals..." empty-state (2a).
- Suppress `NoDataBanner` while hub-connected + engine `Initializing` (2b). Needs the engine's
  `Initializing`/`Running` status surfaced on `EngineInfo` - the bridge can derive it from the
  barometer `Ready` flag it already receives (`Ready=false` => still loading), avoiding a new engine
  field. Confirm `Ready` is reliably present before relying on it.

---

## Status
4.1 + 4.2 = PLAN ONLY, awaiting Inge. **4.3 is IMPLEMENTED** (see review below).
Next: Inge reviews the plan, picks the headless model (4.2), and decides whether to green-light the
4.1 engine PR to Marius. Related: [[project-signalr-broadcast]], [[project-settings-migration]].

---

## Review - 4.3 UI polish (implemented 2026-07-30)

No bridge or engine change was needed: `Barometer.ready` (false while the engine loads candles, a
global flag mirroring `ApplicationStatus`) and `Barometer.progress` already reach the web app over the
WebSocket, so the engine's startup phase is derived client-side.

**`packages/web/src/App.tsx`**
- `engineLoading` - true only when the live hub is connected AND a barometer tip reports `ready:false`
  (without a hub we cannot tell "booting" from "not running at all", so it stays false).
- `loadProgress` - the first non-empty tip progress string, e.g. `"45 / 118 (JUPUSDT)"`.
- `emptyState` - `'loading'` | `'waiting'` (engine up, no signals yet) | `'filtered'`.
- The `NoDataBanner` is no longer rendered while `engineLoading`, so the false
  "No scanner database found" / "database is empty" amber banner can't flash during startup.

**`packages/web/src/components/SignalTable.tsx`**
- New exported `SignalEmptyState` type + an `EmptyRow` component replacing the single hardcoded
  "No signals match" line, with three distinct messages (spinner + live candle progress while loading;
  "Waiting for the first signals..." on a fresh DB; the original filter hint otherwise).

### Verification
- `pnpm -r typecheck` + web build green.
- Runtime data path confirmed against the live bridge: cached barometer tip = `ready:true,
  progress:""` while the engine is Running, so `engineLoading` derives `false` and current behaviour is
  unchanged (no banner suppression, no spinner).
- **Not yet exercised live:** the `'loading'` state itself needs an engine restart (Inge launches the
  scanner). To see it: quit the scanner, start it again with the UI open - the grid should show the
  spinner + "Loading candles... N/M (SYMBOL)" and NO amber banner, then flip to normal when Running.
