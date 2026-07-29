# Engine PR to Marius: barometer Ready + Progress + faster push while loading (points 1 & 2)

## Why
Marius adopted our SignalR dashboard direction; his `0adb969f` has `DashboardUpdateDto` +
`GetBarometerGraph`. Two things his DTOs lack that our UI needs (agreed with him: we deliver a PR for
1 & 2, he then does point 3 = `GetBarometerValues(quote)` RPC):

1. **`Ready` + `Progress` on the barometer** - the UI shows a live "Loading candles N/M (SYMBOL)"
   line during startup and flips the graph in the instant loading finishes. Both hang on these fields.
2. **Faster push while loading** - his dashboard timer is a fixed 1 min AND `OnDashboardTimerTick`
   early-returns unless `Running`, so during candle-load the UI gets nothing for up to a minute. We
   pushed ~every 2 s while loading.

**`dcbd10dc` does NOT port** - it was 8 lines in our APP-layer `DashBoardInformationViewModel` calling
our `BroadcastBarometer()`; Marius's push lives in CORE `SignalRService.OnDashboardTimerTick` with
different DTOs. So this is a fresh, equivalent implementation on his `0adb969f`. (Tell Marius: the PR
supersedes the `dcbd10dc` offer.)

## Facts (verified in his 0adb969f)
- `CryptoApplicationStatus` = `{ Initializing, Running }`. Loading candles => `Initializing`; flips to
  `Running` when done (Ticker.cs:366 / ThreadLoadData.cs:374).
- `GlobalData.CandleProgressText` (GlobalData.cs:96) = "done / total (symbol)" during load
  (CandleBase.cs:120), set to "" when done (CandleBase.cs:138). => our Progress source.
- `SignalRService._dashboardTimer = new Timer(OnDashboardTimerTick, null, 1min, 1min)` (line 88).
- `OnDashboardTimerTick` (line 149): returns unless `ApplicationStatus == Running` (line 154), then
  `CollectUpdate(SelectedQuote, SelectedInterval)` -> `SendAsync("ReceiveDashboardUpdate", update)`.
- `DashboardDataCollector.CollectUpdate` early-returns an empty dto when `ActiveExchange == null`;
  `GetBarometerValues(quote)` returns a `BarometerValuesDto{Quote}` and fills 1h/4h/1d + `BarometerTime`.
- `CryptoSignalHub.GetBarometerGraph` returns `BarometerGraphDto{Quote,Interval,Points}` (early-returns
  an empty one when exchange/interval/symbol missing).

## Plan (C# engine, branch off his `avalonia` @ 0adb969f)

### Point 1 - Ready + Progress on the DTOs
- [ ] `DashboardDtos.cs`: add to **`BarometerValuesDto`** `public bool Ready { get; set; }` +
      `public string Progress { get; set; } = "";`. Add the same two to **`BarometerGraphDto`** (so a
      graph pull during loading reports not-ready -> UI shows the loading skeleton, graph appears the
      instant Ready flips).
- [ ] `DashboardDataCollector.GetBarometerValues`: set `dto.Ready = GlobalData.ApplicationStatus ==
      CryptoApplicationStatus.Running; dto.Progress = GlobalData.CandleProgressText;` at the TOP (before
      any early return) so they are always populated even before candles/exchange exist.
- [ ] `DashboardDataCollector.CollectUpdate`: populate `dto.BarometerValues = GetBarometerValues(
      selectedQuote)` BEFORE the `ActiveExchange == null` early-return, so loading progress flows even
      while `ActiveExchange` is still null. (LatestBarometerPoint/MarketIndicators/SymbolPrices/Ticker
      can stay behind the exchange check - they're irrelevant during load.)
- [ ] `CryptoSignalHub.GetBarometerGraph`: set `result.Ready` + `result.Progress` (same sources) before
      returning, on every path.

### Point 2 - faster push while loading
- [ ] `SignalRService`: change the timer to tick ~every 2 s:
      `new Timer(OnDashboardTimerTick, null, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(2))`.
- [ ] Add field `private DateTime _lastRunningPushUtc = DateTime.MinValue;`.
- [ ] `OnDashboardTimerTick`: replace the hard `Running` gate with:
      - keep the `_hubContext == null || IsEmulatorMode` guard;
      - if `ApplicationStatus == Running`: throttle to the original ~1-min cadence
        (`if (now - _lastRunningPushUtc < 1min) return; _lastRunningPushUtc = now;`);
      - else (`Initializing`): push every tick (~2 s) so loading progress stays live.
      Then collect + `SendAsync` as today.
      Net: unchanged 1-min cadence once Running; ~2 s progress pushes during load.

### Verify + deliver
- [ ] Build `publish-marius-rp` (osx-arm64, self-contained) - Inge runs it (agent can't: TCC SQLite).
- [ ] Inge live-checks: during startup the UI header shows "Loading candles N/M (SYMBOL)" updating
      ~every 2 s, and the barometer graph appears within a few seconds of load finishing (not up to a
      minute late). Once Running, readings refresh ~1/min as before.
- [ ] Branch off `avalonia`, push to `origin` (Trinity12nl fork), `gh pr create` targeting
      `CryptoMarius/CryptoScanBot:avalonia`. Concise body; note it supersedes `dcbd10dc`.
- [ ] Keep our safety branch `feat/signalr-barometer-prices` untouched.

## Follow-up on OUR side (separate, AFTER Marius merges - do NOT bundle)
Once his DTOs carry Ready/Progress, update the bridge to READ them instead of the current fallback:
`packages/bridge/src/signalr-dto.ts` `parseBarometerValues` (ready/progress from `BarometerValues`) and
`parseBarometerGraph` (from the graph DTO). Small UI-repo PR. Until then the fallback (ready=true) is
harmless.

## Review (2026-07-29 - DONE, runtime-verified)
- Engine change implemented on `CryptoScanBot-avalonia` branch `feat/barometer-ready-progress`
  (commit `57f77996`, off `0adb969f`): `Ready`+`Progress` on `BarometerValuesDto` + `BarometerGraphDto`;
  set in `GetBarometerValues` (top) + `GetBarometerGraph` on every return path; `CollectUpdate` fills
  `BarometerValues` before the `ActiveExchange` null-check; dashboard timer 1min -> 2s with a 1-min
  throttle once `Running`. Core builds clean; published to `publish-marius-rp` for Inge.
- **Runtime-verified:** Inge switched to Okx Spot (fresh candle load) and the header showed the
  pulsating candles + "Loading candles... 45 / 118 (JUPUSDT)" ticking live, readings 0.00 while loading.
  Probe confirmed the fields serialize (`GRAPH PULL ... Ready=true`, `BAROMETER ... Ready=false` at the
  load->run transition).
- **Delivered:** cross-fork PR **`CryptoMarius/CryptoScanBot#13`** (base `avalonia`, head
  `Trinity12nl:feat/barometer-ready-progress`, Dutch body, notes it supersedes `dcbd10dc`). Point 3
  (`GetBarometerValues(quote)` RPC) is Marius' after he merges.
- **Our follow-up (this PR):** bridge `signalr-dto.ts` reads `Ready`/`Progress` (optional wire fields,
  fallback `ready=true`) + `probe-signalr.mjs` prints them. cryptoscanbot-ui v0.8.12.
- Safety branch `feat/signalr-barometer-prices` untouched.
