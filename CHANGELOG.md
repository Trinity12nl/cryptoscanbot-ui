# Changelog

All notable changes to **CryptoScanBot-app** (this UI + bridge) are documented here.
Format: change type - **NEW** / **IMPROVED** / **FIX** / **TECH** - and what changed.
Uses [semantic versioning](https://semver.org/).

> **Note on the engine.** This app is the UI/UX layer; the scanning **engine is Marius' C#
> CryptoScanBot** (the `avalonia` branch), which has its **own** changelog and versioning upstream.
> We track that engine but do not own it, so this changelog covers only the app (bridge + web +
> desktop). Engine repo (link may change): <https://github.com/CryptoMarius/CryptoScanBot>.

## v0.3.3 - 2026-07-24

### NEW
- **Exchange switch reflects live.** When the engine switches active exchange, the header updates on its own (within ~5s) instead of only after a manual page refresh - the bridge now polls engine info and pushes it on change.

### FIX
- **Symbol list matches the active exchange.** The list showed a cross-exchange union (a symbol exists once per exchange), so it could show the wrong exchange's symbols. It now filters to the active exchange, joining on the real `ExchangeId` (the `Symbol.ExchangeName` column is a C# quirk that stores the symbol's own name), and reloads when you switch exchange.
- **Correct active exchange.** The header took the most recently symbol-refreshed exchange (`LastTimeFetched`), which lags a switch by up to an hour; it now reads the active exchange from the engine's settings (`ActivateExchangeName`).

### IMPROVED
- **Symbol list self-corrects during a backfill.** Right after an exchange switch the engine fills in volumes gradually; the list now refreshes every 60s so the filtered count climbs to the real value without a manual reload.

## v0.3.2 - 2026-07-24

### NEW
- **Full filter catalog with "not scanning".** The strategy and interval filters now list the whole known set, with the ones the engine is not scanning dimmed and tagged `not scanning` (active ones first) - instead of only whatever happened to fire. Ported from the old app.
- **"Settings changed" marker.** When the engine's scan config actually changes (a strategy/interval toggle, quote coins, exchange or expiry), an amber row marks it in the signal table ("signals below used previous settings"), and the filter re-syncs to what is now scanning so newly enabled strategies show. Detection keys off a signature of the scan-relevant fields, so the engine's own bookkeeping rewrites no longer trigger a false marker.
- **Signal counter + Load more.** The header now reads `N shown - M today`, and a `Load more` button pages through the list (100 at a time).
- **Reset filters.** A subtle `Reset` text link (with an info tooltip) returns the filters to what the engine is currently scanning; this scanned set is also the default on load.
- **Symbols panel upgrade.** Sticky, sortable header (default by symbol, like Avalonia), `Esc` clears the filter, only active quote coins are listed, zero-volume symbols are hidden, and volume above the configured threshold is highlighted.

### IMPROVED
- **New-signal highlight** restored to the old 5s soft-green fade.
- **Sticky headers keep their bottom line** while scrolling (box-shadow instead of a border that dropped out under `border-collapse`), and row hover is more visible in light mode.

### TECH
- Bridge exposes `configSignature` + `lastChangedMs` on `EngineSettings`; the app keys the settings-changed marker off the signature.

## v0.3.1 - 2026-07-23

### TECH
- **Strategy-name sync with upstream.** Marius renamed two strategies in the avalonia engine to match their real formula: `Baba` -> `Vbs` (VWAP Bands, id 28) and `Bre` -> `Dbr` (Donchian Breakout Reversion, id 30). The enum values are unchanged, so this is display-only; updated `STRATEGY_NAMES` so the grid shows the current names.
- **Version aligned to 0.3.1.** All workspace packages were still at `0.1.0`, so installers were named `... 0.1.0.exe` despite shipping the current feature set. Bumped every `package.json` to match this changelog. First build validated running native in a Windows 11 (ARM) UTM VM against Marius' live C# engine, reading the shared `%APPDATA%\CryptoScanBot` DB with row-for-row signal parity.
- **Renamed the app to `CryptoScanBot-ui`.** Installer/exe, macOS `.dmg`, window title, browser tab and the header now read `CryptoScanBot-ui` - the `-ui` suffix makes clear this is the UI, not the scanner engine itself (Phase A). Also changed `appId` to `com.cryptoscanbot.ui`, which moves the app's own Electron data out of the engine's `%APPDATA%\CryptoScanBot` folder (no more collision). The `defaultDbPath()` that reads the engine DB is unchanged, so the connection to the scanner keeps working.

## v0.3.0 - 2026-07-22

### NEW
- **App logo in the UI.** The lightning-bolt logo now appears in the header and as the browser tab favicon (same art as the desktop app icon).
- **Smart filters from engine settings.** The bridge reads the engine's settings JSON (read-only) and the filter dropdowns dim the strategies, intervals, and sides that are switched OFF in the engine - so you instantly see what is actually scanning vs. dormant. Reflects the active exchange. Updates live if you change settings in the engine.
- **Expired-signal dimming.** Signals older than the engine's "remove after N candles" setting are dimmed in the grid (off when the setting is 0). Matches the old app's freshness cue.

### TECH
- **`/api/settings` + `EngineSettings` contract.** New `SettingsSource` in the bridge (polls the settings file, pushes changes over WebSocket); the UI consumes it through the same seam, so Phase B's headless host can serve the same shape later.

## v0.2.0 - 2026-07-22

### NEW
- **Desktop app (Electron shell).** The UI now runs as a native window - off UTM, off the browser. In dev it loads Vite for hot-reload; when packaged it starts the bridge in-process and serves the built UI same-origin. Runs the bridge in the same process, so there is nothing extra to launch.
- **App icon.** Our own: a glossy emerald squircle with a glowing lightning bolt (the ⚡ from the app), shipped as `.icns` for macOS and `.ico` for Windows.
- **macOS installer (.dmg).** `pnpm --filter @csb/desktop dist` produces a double-clickable Apple-Silicon `.dmg`. Unsigned for now (right-click > Open on first launch); notarization later.
- **Windows build (.exe).** electron-builder config for an NSIS installer + a portable `.exe`, plus a GitHub Actions workflow that builds macOS and Windows on their own runners. This is what lets Marius run HIS engine with OUR UI. See `packages/desktop/BUILD.md`.

### IMPROVED
- **Sticky table header.** Column labels stay visible while scrolling the signal grid, so you always know which column you are reading.

### TECH
- **Bridge is now an importable library.** Split the runnable CLI from a barrel export so the Electron main can start the bridge in-process via one shared `startBridgeDefault()`; the bridge can also serve the built web UI (SPA fallback) for the same-origin packaged app.
- **Native-deps hygiene.** `.pnpmfile.cjs` strips the optional `bufferutil` / `utf-8-validate` addons (unneeded, and they force a broken native compile); only `better-sqlite3` is rebuilt for Electron's ABI, from a prebuilt binary.

## v0.1.0 - 2026-07-21

### NEW
- **Cross-platform scanner UI.** Fresh repo: a web + desktop (Electron) UI on top of the C# engine, which compiles and runs native on macOS and writes a SQLite oracle. Goal: our own modern UI/UX, off UTM, off the old Windows look.
- **Live signal grid.** Sortable, with a column show/hide picker (All / Default / None), drag-to-reorder columns, layout persisted to localStorage, a new-signal flash, and row-click to open the TradingView chart.
- **Extended columns.** Beyond the C# grid, hidden by default in the picker: RSI, Stoch, Stoch-Signal, MACD histogram, Effective %, Barcode, Text, Exchange, Id. Trend is shown as two columns - Dow and BOS - with a ⚡ marker where they disagree.
- **Filters.** Strategy and interval multi-selects, plus a long / short / all side toggle.
- **Live Change column.** Live price vs the signal price (%), coloured by whether the move favours the position (a drop is a gain for a short). Fed by a public exchange ticker feed in the bridge; will later move to the headless C# host behind the same data seam.
- **Light / dark theme.** Follows the OS by default, with a manual toggle that is remembered.
- **In-app changelog.** This viewer - opened from the header, with a dot when there is something new. It renders `CHANGELOG.md` directly, so the file stays the single source of truth.

### TECH
- **Monorepo (pnpm).** `shared` (the `ScannerDataSource` data contract + DTOs - the seam that keeps Phase B a drop-in backend swap), `bridge` (Node HTTP/WS reading the engine's SQLite oracle + a ccxt ticker feed), `web` (React 19 + Vite 6 + Tailwind), `desktop` (Electron shell, next).
- **Avalonia enum ids.** Strategy names use the avalonia branch's enum ids (the older 2.0.x ids were renumbered).
