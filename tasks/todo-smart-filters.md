# Smart-select filters from engine settings

Inge's idea: cherry-pick the old app's "smart select" filters - the ones that grey out options
that are switched off in the engine, so you see what's actually scanning vs. dormant.

## Finding: settings are JSON, not in the DB
The C# engine stores settings as JSON files next to the oracle DB (not in SQLite):
`~/Library/Application Support/CryptoScanBot/CryptoScanBot-settings.json` (+ -exchange, -user, ...).
So we read them as files - read-only (the engine owns them; we never write).

Filter-relevant keys in `CryptoScanBot-settings.json`:
- `Signal.{Stobb,Sbm,Jump,ZonesDlz,ZonesFvg,ZonesSmc,Nwe,Bbma,Choch}` - enabled strategies (bool)
- `Signal.{Long,Short}` - enabled sides (bool)
- `QuoteCoins.{USDT,USDC}` - `{ FetchCandles, MinimalVolume, ... }` (which quotes are actively scanned)
- `General.ActivateExchangeName` - the running exchange
- Intervals: TODO - confirm where active scan intervals live (likely nested in `Signal.AnalyzerSettings`).

## Plan (needs Inge's OK before building)

### 1. Shared contract (`@csb/shared`)
- Add `EngineSettings` type: `{ activeExchange, strategies: Record<string,boolean>,
  sides: {long,short}, quoteCoins: {name,minVolume,active}[], intervals?: number[] }`.

### 2. Bridge (`@csb/bridge`)
- New `SettingsSource` that reads the JSON file(s) from the engine's app-data folder (same folder as
  the DB, resolved per-OS like `defaultDbPath()`). Parse + normalize to `EngineSettings`.
- Map the C# setting names to our avalonia strategy ids (Stobb/Sbm/Jump/ZonesFvg/... -> STRATEGY_NAMES).
- Expose `GET /api/settings`; include it in the WS `info` push. Poll the file mtime (cheap) so a
  settings change in the engine reflects without a restart.
- Fits the seam: Phase B headless host later serves the same `/api/settings`.

### 3. Web (`@csb/web`)
- Cherry-pick the old `MultiSelect` "inactive option" treatment (greyed + a tooltip like
  "off in engine settings"). Old ref: `CryptoScanBot-new/.../components/FilterBar.tsx` +
  `MultiSelect.tsx` (they take `defaultFilters` = the active set and dim the rest).
- Apply to the existing FilterBar: strategy + side + (new) quote-coin selects driven by
  `EngineSettings`. Options stay selectable (you may still want to see dormant history), just marked.
- Optional: a small "engine config" hint - e.g. quote-coin min-volume shown as a tooltip.

## Notes / decisions to confirm
- Read-only: we surface engine settings, we do NOT edit them (the old app had a full settings editor;
  out of scope here - the engine owns its config in Phase A).
- Multi-exchange: Inge runs Bybit Spot + Futures (separate per-exchange DBs). Confirm whether smart
  filters should reflect just the active exchange or all configured ones.
- Strategy-name mapping (C# setting bool -> our strategy id) needs a small lookup table; verify each
  against `CryptoScanBot-original` / the avalonia enum.

## Review

### Done (2026-07-22)
Built + verified against the live engine settings. Active exchange only, read-only.
- **Shared:** `EngineSettings` (activeExchange, enabledStrategies, enabledIntervals, sides, quoteCoins,
  removeSignalAfterCandles) + `signalExpiryMs()` + a `settings` WS event.
- **Bridge:** `SettingsSource` reads `CryptoScanBot-settings.json` (beside the DB), mtime-cached,
  polled every 10s and pushed over WS. `GET /api/settings`. Wired via `startBridgeDefault`.
- **Web:** `MultiSelect` gained a dimmed "off" treatment; `FilterBar` dims strategies + intervals +
  sides that are off in the engine; `SignalTable` dims expired rows via `removeSignalAfterCandles`.

**Correction during build:** the enabled strategies/intervals are NOT top-level booleans - they live
under `Signal.Long` / `Signal.Short` as `Strategy: []` / `Interval: []`. We union both sides and map
strategy keys case-insensitively to STRATEGY_NAMES. Verified: enabled = Sbm1/2/3 + Stobb, intervals
1m/3m/5m, both sides on, USDT active (min 2M). `RemoveSignalAfterxCandles` is currently 0 (no dimming
until Inge sets it > 0).

### Notes
- Freshness (expired dimming) added per Inge's follow-up; re-computes on each render (prices tick ~4s).
- Quote-coin filter not added (no existing quote filter in the UI); the data is exposed if we want it.
- Strategy-name mapping is by display name; if a future engine strategy isn't in STRATEGY_NAMES it
  simply won't be dimmed. Revisit if the avalonia enum grows.
