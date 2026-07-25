# Changelog

All notable changes to **CryptoScanBot-ui** (this UI + bridge) are documented here.
Format: change type - **NEW** / **IMPROVED** / **FIX** / **TECH** - and what changed.
Uses [semantic versioning](https://semver.org/).

> **Note on the engine.** This app is the UI/UX layer; the scanning **engine is Marius' C#
> CryptoScanBot** (the `avalonia` branch), which has its **own** changelog and versioning upstream.
> We track that engine but do not own it, so this changelog covers only the app (bridge + web +
> desktop). Engine repo (link may change): <https://github.com/CryptoMarius/CryptoScanBot>.

## v0.8.0 - 2026-07-25

### NEW
- **Version badge in the header.** The app version (e.g. `v0.8.0`) now shows small and muted directly under "CryptoScanBot-ui" in the top-left, so it's always obvious which build you're on when reporting an issue. Baked in at build time, so it's correct in both dev and the packaged app.
- **"Did you mean this folder?" one-click fix.** When the app finds no database at the folder it's pointed at, it now looks for a `CryptoScanBot.db` in a nearby folder (an immediate subfolder or the parent) and, if it finds one, the amber banner offers a one-click **Use `<folder>`** button to switch to it. This catches the common trap where you pick one level off - the engine writes the DB in e.g. `…\Futures` but also creates a same-looking `Binance Futures` subfolder right next to it, so it's easy to select the child (or the grandparent). The folder picker itself is unchanged: it still stores exactly the folder you choose - detection only ever *suggests*, it never silently re-points.

### IMPROVED
- **Visible feedback while switching data folder.** Changing the data folder restarts the bridge and reloads the page (~1-2s); previously that happened with no on-screen response, so the action looked dead until it suddenly snapped to the new folder. The banner's **Use `<folder>`** button and the Settings **Choose folder… / Reset** buttons now immediately show a **"Switching…"** spinner and go disabled, so you can see it's working.

### TECH
- **Nearby-DB lookup + suggestion plumbing.** New bridge helper `findOracleDbDir(dir)` (pure lookup: checks the folder -> its immediate subfolders -> its parent for `CryptoScanBot.db`). `EngineInfo` gains `suggestedDataDir` (populated only when the expected DB is absent). Desktop gains a `csb:setDataFolder` IPC + `window.csb.setDataFolder(dir)` so the banner button can re-point the in-process bridge directly (no dialog). Version is exposed to the web via a vite `define` (`__APP_VERSION__`) read from `web/package.json`.

## v0.7.0 - 2026-07-25

### NEW
- **Phase B live link (opt-in).** The bridge can now connect to the C# engine's SignalR hub (Marius' avalonia `SignalRService`, default `http://localhost:5200/signalr/signals`) for **real engine liveness** - "online" now means a live hub connection, not just "the DB file exists" - and **near-instant signal push** (a new signal pokes the oracle to read immediately instead of waiting for the ~1.5s poll). Off by default; enable with `CSB_SIGNALR=1` (or `CSB_SIGNALR_URL=...`) on the bridge **and** `General.SignalREnabled = true` in the engine. Without it, behaviour is exactly as before.
- **Per-timeframe barometer + trend columns.** Two new (optional, off by default) signal columns show the market **barometer** and **trend direction** at signal time across 15m/30m/1h/4h/1d - compact coloured readouts (barometer numbers; trend ▲/▼). Enable them in the column picker.

### FIX
- **A transient error no longer blanks the whole screen.** The initial load fetched info + signals + prices + settings as one all-or-nothing `Promise.all`, so a single hiccup (e.g. a query 500'ing while the engine's startup sync holds the DB write lock) wiped everything until a manual reload. Each now loads independently, and the signal history retries a few times before giving up - so a blip on one call can't erase the rest (and info/prices/settings also stream in over the WebSocket).
- **Offline no longer claims "no database".** Liveness (`connected`) and DB-presence (`dbPresent`) are now separate `EngineInfo` fields: quitting the engine correctly flips the dot to offline while the "No scanner database found" banner stays hidden (the DB file is still there). Previously the banner keyed off `connected`, so an offline engine looked like a missing DB.
- **Hub is authoritative for liveness once connected.** After the SignalR hub has connected at least once, the live connection drives online/offline (so killing the engine goes offline even though its `.db` lingers); before any connect, it falls back to the DB-exists check (unchanged Phase A behaviour).

### TECH
- **SignalR hybrid data source.** New `SignalrSource` (self-managed reconnect, graceful when the hub is absent) + `HybridDataSource` compose behind the existing `ScannerDataSource` seam: the SQLite oracle stays the source of truth for signal data/history/symbols, SignalR adds liveness + a push trigger, so the UI is unchanged. `SqliteDataSource` gains `pollNow()`.
- **Barometer/trend from the oracle.** The oracle `Signal` table already stores `Barometer15m..1d` and `Trend15m..1d`; the bridge now reads them into the `Signal` DTO (`barometer`/`trend`, trend normalised to up/down, Unknown -> null), so they show for all signals including history - not just live ones.

## v0.6.2 - 2026-07-25

### FIX
- **Signals from dotted/aliased strategies no longer hidden.** The default signal filter mirrors the strategies the engine is scanning, but the bridge matched the engine's settings keys to strategy names by naive lowercasing - so the engine's dotted keys (`bbma.omni`, `stobb.multi`, `choch.primary`) and aliases (`dlz`, `fvg`, `smc`) never matched, and their signals (e.g. BbmaOmni on USDCUSDT / USD1USDT) were silently filtered out. Strategy-key matching is now ported from the engine's own plugin registrations, so all 27 settings keys resolve correctly.

### TECH
- **Strategy-key mapping.** `@csb/shared` gains `strategyNameFromSettingsKey` (normalises punctuation + a small alias table for `dlz`/`dlz.near`/`fvg`/`smc`/`smc.rejection`) and the 4 enum ids that were missing from `STRATEGY_NAMES` (`NweNp`, `NweBb`, `BbSqueeze`, `OrderBlockRejection`). The bridge's `enabledStrategies` now uses it instead of the lowercased-name heuristic.

## v0.6.1 - 2026-07-24

### FIX
- **Packaged app now launches (better-sqlite3 Electron ABI).** The `.dmg`/`.exe` shipped a `better-sqlite3` compiled for Node's ABI (127), but Electron 33 needs ABI 130 - so the in-process bridge failed to load it and the window never appeared. The build now runs `electron-rebuild` before packaging, which **downloads** better-sqlite3's official `electron-v130` prebuilt for each platform (macOS arm64 + Windows x64) - no C/C++ compiler, Python distutils or MSVC needed on any runner. Verified: the binary inside the built `.dmg` is byte-identical to the upstream Electron prebuilt.

### TECH
- **Electron-ABI build wiring.** `@csb/desktop` gains an `@electron/rebuild` devDep + a `rebuild:native` script (`electron-rebuild -f -o better-sqlite3`), wired into `dist` before `electron-builder`. Set `npmRebuild: false` in `electron-builder.yml` (electron-builder's own rebuild was unreliable under pnpm's symlinked store and could revert the ABI). CI `build.yml` fetches the Electron prebuilt via that script instead of the old Node-ABI `pnpm rebuild better-sqlite3`.

## v0.6.0 - 2026-07-24

### NEW
- **Custom engine data folder.** Users who start the C# engine with `-f "datafolder"` write their DB outside the standard OS path, so the UI showed no signals. You can now point the app at that folder: a gear in the header opens a data-folder setting with a native folder picker (desktop), and the bridge re-points there (DB, settings and per-exchange candle DBs all follow). Dev/browser: set `CSB_DATA_DIR` on the bridge.
- **"No data" banner.** When the bridge finds no database (or an empty one) at the path it's reading, an amber banner names the exact path and explains the `-f` fix - instead of a silent empty screen.

### TECH
- **Centralised data-path resolution.** Bridge: `resolveDbPath({ dataDir })` / `resolveSettingsPath({ dataDir })` centralise path resolution (precedence: explicit path → dataDir → `CSB_DB_PATH` → `CSB_DATA_DIR` → OS default); `startBridgeDefault` takes a `dataDir`. Electron gains a preload (`window.csb`) + IPC to pick/persist the folder and restart the in-process bridge.

## v0.5.0 - 2026-07-24

**Phase A milestone.** First tagged release: a cross-platform desktop app (macOS `.dmg` + Windows `.exe`) that reads Marius' C# CryptoScanBot engine's SQLite oracle read-only and presents signals, filters, symbols and engine status live. This marks the end of Phase A (read the engine's DB); Phase B will add a two-way headless/SignalR link for live, in-memory data (barometer, prices, real engine liveness).

### NEW
- **Automated release builds.** Pushing a `v*` tag now builds the macOS and Windows installers on their own runners and publishes them as a GitHub Release with the `.dmg` and `.exe` attached.

### TECH
- Rolled up everything from v0.3.x: live exchange-switch push, active-exchange-from-settings, active-exchange symbol list, and the silent background symbol refresh.

## v0.3.4 - 2026-07-24

### FIX
- **No false error banner on a transient symbol refresh.** The 60s background symbol refresh is now silent - it keeps the last good list when a poll fails (the engine briefly 500s DB reads while it churns its tables on restart/backfill) instead of raising the red banner, and a successful fetch clears any stale symbols error. Only the initial load / exchange switch surfaces a hard error.

## v0.3.3 - 2026-07-24

### NEW
- **Exchange switch reflects live.** When the engine switches active exchange, the header updates on its own (within ~5s) instead of only after a manual page refresh - the bridge now polls engine info and pushes it on change.

### IMPROVED
- **Symbol list self-corrects during a backfill.** Right after an exchange switch the engine fills in volumes gradually; the list now refreshes every 60s so the filtered count climbs to the real value without a manual reload.

### FIX
- **Symbol list matches the active exchange.** The list showed a cross-exchange union (a symbol exists once per exchange), so it could show the wrong exchange's symbols. It now filters to the active exchange, joining on the real `ExchangeId` (the `Symbol.ExchangeName` column is a C# quirk that stores the symbol's own name), and reloads when you switch exchange.
- **Correct active exchange.** The header took the most recently symbol-refreshed exchange (`LastTimeFetched`), which lags a switch by up to an hour; it now reads the active exchange from the engine's settings (`ActivateExchangeName`).

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
