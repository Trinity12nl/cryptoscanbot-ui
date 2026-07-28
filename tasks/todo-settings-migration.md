# Settings migration - edit the scanner's settings from our UI

Goal: a settings page in cryptoscanbot-ui that mirrors the C# scanner's configuration dialog
(same tabs, same fields, same grouping), reads the engine's current settings, and **writes changes
back to the engine and applies them live** - so the user configures the scanner from our app.

## What exists today (starting point)

- **Read (partial):** `packages/bridge/src/settings-source.ts` reads the engine's
  `CryptoScanBot-settings.json` and projects a small `EngineSettings` (activeExchange,
  enabledStrategies, enabledIntervals, sides, quoteCoins, removeSignalAfterCandles) used only to
  drive the signal filters. It is **read-only** and a **subset**.
- **UI:** only `DataFolderSettings` + `SignalRToggle` (gear menu). No general settings editor.
- **Old app reference (cherry-pick, don't reinvent):** `CryptoScanBot-new/packages/web/src/pages/
  SettingsPage.tsx` + `components/settings/*` (BarometerSettings, SignalFilterSettings, ...) - a
  tabbed settings UI we can lift the look/structure from. See [[feedback-cherrypick-old-ui]].

## The scanner's settings model (source of truth)

Engine writes `CryptoScanBot-settings.json` (+ `-telegram.json`, `-exchange.json`, `-altrady.json`)
in its AppDataFolder via `GlobalData.SaveConfiguration()`. Root = `SettingsBasic`:

| JSON group | C# type | Scanner tab(s) | Scope |
|---|---|---|---|
| `General` | SettingsGeneral | Common / General | in |
| `Signal` (+ `Signal.AnalyzerSettings`) | SettingsSignal | Analyzer, Strategy, Indicators (Stoch/RSI/BB/ZigZag) | in |
| `Trend` | SettingsTrend | Barometer filter, Market-trend / interval filter | in |
| `QuoteCoins` | SortedList<CryptoQuoteData> | Quote | in |
| `WhiteList*/BlackList*` | List<string> | Black & white list | in |
| `ShowSymbolInformation` | List<string> | (drives the header Crypto Prices list - BTC/PAXG/ETH/XRP/SOL/ADA) | in |
| `Trading` | SettingsTrading | Trader (DCA/Entry/TP/SL/Rules/Futures/Misc) | in - **pass-through editor** (we don't implement trading, but expose the engine's config) |
| telegram.json | SettingsTelegram | API / Telegram | in (token = secret) |
| exchange.json | SettingsExchangeApi | API (exchange keys) | **deferred** (secrets - later, masked) |
| altrady.json | SettingsAltradyApi | API (Altrady) | **deferred** (trading/secrets) |
| Sound & Colors | SettingsUser | Sound/Colors | in (local-ish) |
| Debug | (General/Debug flags) | Debug | in |

## The crux: how changes get applied (write-back)

The engine has **no file-watcher** - writing the JSON alone does NOT apply. The scanner's own dialog
(`CommandShowConfiguration`) does this after the user clicks OK:
1. `GlobalData.SaveConfiguration()` (writes the JSON).
2. Detect if **exchange** or **quote coins** changed.
3. If yes: `scannerSession.StopAsync()` -> clear exchange/candle data -> `ApplyConfigurationAsync(true)`
   -> `ScheduleRefresh()` -> `ExchangeSwitchedMessage`.
4. If no: `ApplyConfigurationAsync(false)` -> `SymbolsHaveChangedMessage`.
5. Always: `ConfigurationChangedMessage` (reset cached strategy colors).

**Chosen write-back = a new SignalR command** that replays exactly this flow server-side (mirrors the
existing broadcast architecture; no fragile file-writing from the bridge, no engine restart):

- New hub method `ApplySettings(string settingsJson)` (and later `ApplyTelegram`, etc.).
- Because the apply logic needs `ScannerSession` (app layer), use the same **APP -> CORE boundary** as
  the market indicators: the app registers an "apply settings" handler on `SignalRService`; the hub
  invokes it. The handler deserializes into `GlobalData.Settings`, then runs steps 1-5 above.
- Round-trip safety: the editor works on the **raw settings JSON object**, edits only known fields, and
  sends the whole object back - so fields we don't render (and any Trading block) pass through
  untouched. We never rebuild the full model in TS.

## Plan (phased - one PR per phase)

### Phase 0 - read the full settings (foundation) - DONE (v0.8.9)
- [x] Bridge: add `getRaw()` / `GET /api/settings/raw` returning the parsed
      `CryptoScanBot-settings.json` verbatim (kept the existing `EngineSettings` projection for filters).
- [x] Bridge: broadcast a `settingsRaw` change when the file mtime changes (reuses the existing 10s
      mtime poll; `subscribeRaw` fires off the same read as the normalized `subscribe`), + snapshot on
      WS connect.
- [x] shared: a permissive `RawSettings = Record<string, unknown>` type + `settingsRaw` BridgeEvent.
- [x] web: `fetchRawSettings()` in lib/api.ts (used by the settings page in Phase 2).
- [x] probe:bridge prints the raw settings groups (REST + WS) for verification.

### Phase 1 - write-back plumbing (C#, local-only avalonia branch)
- [ ] Core `SignalRService`: `ApplySettingsHandler` delegate + `ApplySettings` invoked from the hub.
- [ ] Hub `ApplySettings(json)` -> handler.
- [ ] App: register the handler; implement the deserialize + SaveConfiguration + exchange/quote-change
      detection + `ApplyConfigurationAsync` + MVVM messages (factor the shared bits out of
      `CommandShowConfiguration`).
- [ ] Bridge: `applySettings(raw)` on the SignalR source + `POST /api/settings` -> hub invoke.
- [ ] Build + publish; verify via probe (send a harmless change, confirm the engine applies + re-broadcasts).

> **DESIGN FINDING (must handle before coding Phase 1).** `CommandShowConfiguration` does NOT replace
> `GlobalData.Settings`; the config dialog binds to and mutates the EXISTING object **in place**, which
> preserves runtime-only state that lives on the same objects - notably each `QuoteCoins` entry's
> `SymbolList` (and `Status`). The change-detection `GetQuoteRelatedSettings()` reads that runtime state
> (`quoteData.FetchCandles && quoteData.SymbolList.Count > 0`). So the `ApplySettings` handler must NOT
> `JsonSerializer.Deserialize<SettingsBasic>(json)` and swap it into `GlobalData.Settings` - that would
> zero every `SymbolList`, wrongly report all quotes as changed (forcing a full stop+reload every save),
> and drop loaded candle data. Instead **merge the incoming JSON field-by-field onto the existing
> `GlobalData.Settings`** (update scalars on `General`/`Trend`/`Trading`/`Signal`; for `QuoteCoins`
> update `MinimalVolume`/`FetchCandles` on the existing entries by name, add/remove entries as needed,
> keeping their runtime lists). Capture `previousExchange`/`previousActiveQuotes`/`previousExchangeName`
> BEFORE the merge, then run the same steps 1-5 as the dialog. This is exactly why Phase 1 needs Inge's
> live runtime verification and shouldn't be shipped on compile-check alone.

### Phase 2a - settings VIEWER (read-only) - DONE (v0.9.0, branch feat/settings-viewer, stacked on Phase 0)
- [x] Settings modal opened from a new sliders icon in the header, with the scanner's tab list
      (General, Signal, Trend, Indicators, Quote, Lists, Trading, Debug), styled like the app.
- [x] Generic read-only value renderer (`SettingsValue.tsx`): primitives as labelled rows, booleans as
      On/Off pills, nested objects as indented sub-sections, arrays as chips - so it renders any part of
      the raw settings without a hand-written field list per tab. General's Debug* + indicator blocks are
      split into the Debug / Indicators tabs.
- [x] Reads `GET /api/settings/raw` on open (works in Live AND Polling mode - the bridge reads the file).
- [x] Verified: `pnpm -r typecheck` + `pnpm --filter @csb/web build` green; endpoint served through the
      Vite proxy returns 200. **Visual layout not yet reviewed in a browser (extension was offline) -
      Inge to eyeball it and steer styling before the PR is opened.**

### Phase 2b - settings EDITOR (write-back) - needs Phase 1
- [ ] Reusable field CONTROLS (text/number/toggle/select/multiselect/list-editor) themed like the app.
- [ ] Implement **General** tab end-to-end (load -> edit -> Save -> ApplySettings -> confirm applied).
- [ ] Dirty-tracking + Save/Cancel + "changed, restart-scope" hint (exchange/quote changes = heavier apply).

### Phase 3+ - remaining tabs (one PR each)
- [ ] Signal + Analyzer/Strategy/Indicators (biggest; the strategy list + per-strategy entry conditions).
- [ ] Trend / Barometer filter.  [ ] Quote coins.  [ ] Black & white lists.
- [ ] Telegram (mask the token).  [ ] Sound & Colors.  [ ] Debug.
- [ ] Trading (pass-through editor - render the SettingsTrading fields; no trading logic our side).

### Deferred
- Exchange API keys + Altrady (secrets - later, with a masked write-only design).

## Risks / unknowns
- **Field fidelity:** matching every scanner field + validation is large; the JSON is the contract, so
  we render known fields and pass the rest through. Exact per-tab field lists come from the Config
  `Views/*.axaml` when we build each tab.
- **Apply side-effects:** exchange/quote changes stop+reload the scanner (seconds of churn) - the UI
  must warn before applying those.
- **Concurrency:** if the user edits in BOTH the scanner dialog and our UI, last-write-wins on the
  whole object. Acceptable for single-user; note it.
- **Phase A (no SignalR):** no write-back without the hub. Settings editor is Phase-B only (gate like
  the market header), or read-only in Phase A.

## Decisions (agreed with Inge)
1. **Tab scope:** ALL tabs, including **Trading** as a pass-through editor (we don't implement trading,
   but expose + write the engine's Trading config like any other tab).
2. **Exchange API keys / Altrady:** deferred (secrets) - revisit with a masked, write-only design.
3. **Fidelity:** mirror the scanner's tab structure + every field, styled like the rest of our app
   (not a pixel-match) - consistent with the market header we just built.

## Review

### Phase 0 (v0.8.9) - raw settings through the bridge
- `shared`: added `RawSettings = Record<string, unknown>` (the verbatim settings object the editor
  works on) + a `settingsRaw` variant on `BridgeEvent`.
- `bridge/settings-source.ts`: added a cached verbatim parse (`refresh()` now feeds both the normalized
  filter view and the raw object off one file read), `getRaw()`, and `subscribeRaw()`. Renamed the
  private projection interface `RawSettings` -> `SettingsShape` to free the name for the shared type.
- `bridge/server.ts`: `GET /api/settings/raw`, a `settingsRaw` snapshot on WS connect, and a broadcast
  when the file changes; cleanup wired into `close()`.
- `web/lib/api.ts`: `fetchRawSettings()`.
- `probe-bridge.mjs`: prints the raw settings groups over REST + WS.
- **Verified end-to-end** against a fresh bridge on :4501 reading the live oracle settings file:
  `/api/settings/raw` -> 200 with groups `[General, Signal, Trend, Trading, QuoteCoins, WhiteList*,
  BlackList*, ShowSymbolInformation]`; WS delivered `settingsRaw` on connect. Old bridge on :4399
  (pre-change) 404s the route, confirming it's genuinely new. No C# changes; read-only; safe for the
  pending Tickers test.

### Phase 2a (v0.9.0) - read-only settings viewer (branch feat/settings-viewer, stacked on Phase 0)
- New `packages/web/src/components/settings/SettingsValue.tsx` (generic read-only renderer: humanized
  labels, On/Off pills, nested sub-sections, chip lists) + `SettingsViewer.tsx` (modal shell, left tab
  rail matching the scanner's tabs, fetches `/api/settings/raw` on open, "View only" badge, footer note
  that editing lands later). Hooked into `Header.tsx` via a new `SlidersHorizontal` button beside the
  data-folder gear.
- Tab mapping: General (minus Debug*/indicator blocks), Signal, Trend, Indicators (General's
  Bb/Rsi/Stoch), Quote (QuoteCoins), Lists (white/black lists + ShowSymbolInformation), Trading
  (pass-through), Debug (General's Debug* flags).
- **Verified:** `pnpm -r typecheck` + `pnpm --filter @csb/web build` green; loaded through an isolated
  bridge(:4501)+Vite(:5401) stack, `/api/settings/raw` 200 via the proxy. NOT visually reviewed in a
  browser yet (extension offline overnight) - **PR intentionally NOT opened; awaiting Inge's eyeball +
  styling steer.** Branch pushed for preview.
