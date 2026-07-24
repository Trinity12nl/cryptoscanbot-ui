# Custom engine data folder (`-f`) support

## Problem (from Marius, 2026-07-24)
Some users launch the C# engine with `-e "exchange name" -f "datafolder"`. `-f` puts the engine's
data (DB, settings JSON, per-exchange candle DBs, logs) in a NON-standard folder. Our bridge only
looks at the standard OS path (`defaultDbPath()` -> `%APPDATA%\CryptoScanBot` / `~/Library/Application
Support/CryptoScanBot`), so for those users the UI finds no DB and shows **no signals**, with no hint
why.

`-e` (active exchange) needs no separate handling: we already read the active exchange from the
engine's `settings.json` (`ActivateExchangeName`). The data FOLDER is the only real gap.

## Current state
- `sqlite-source.ts`: `new SqliteDataSource()` uses `process.env.CSB_DB_PATH || defaultDbPath()`.
- `settings-source.ts`: `defaultSettingsPath()` = `dirname(dbPath)/CryptoScanBot-settings.json`.
- Candle-DB freshness / symbol reads derive from `dirname(dbPath)` too.
- So EVERYTHING already derives from one folder - we just need that folder to be user-settable.
- Bridge is wired in `bootstrap.ts` `startBridgeDefault()`; desktop starts it in-process
  (`packages/desktop/src/main.ts`), env-vars only, **no settings UI, no preload/IPC**.

## Approach (staged - keep each change small)

### Stage 1 - Bridge: a first-class data-dir (low risk, unblocks power users + dev + desktop wiring)
- [ ] Add `CSB_DATA_DIR` (a FOLDER). Resolution order for the DB path: `CSB_DB_PATH` (explicit file,
      back-compat) -> `CSB_DATA_DIR`/`CryptoScanBot.db` -> `defaultDbPath()`.
- [ ] Centralise this in one `resolveDbPath()` (in `sqlite-source.ts`) and have `SettingsSource`
      derive from the SAME resolved path (it already uses `dirname`), so settings + candle DBs follow
      automatically. `SqliteDataSource` and `SettingsSource` take an optional `dataDir`/`dbPath` arg
      so `startBridgeDefault` can pass one through (not only env).
- [ ] `startBridgeDefault(port, { staticDir, dataDir })` threads `dataDir` into both sources.

### Stage 2 - Empty/missing-DB UX (cheap, directly answers "why no signals?")
- [ ] When the resolved DB is missing or has zero signals, the header/`info` already exposes
      `dbPath` + `connected`; surface a clear banner: "No scanner data at <path>. If you started the
      engine with `-f <folder>`, set the data folder in Settings." (Turns Marius' silent-empty into a
      self-explaining state.)

### Stage 3 - Desktop: a folder picker (the real user-facing fix for the packaged app)
- [ ] Persist a small config (`app.getPath('userData')/config.json`, `{ dataDir }`).
- [ ] Read it at startup and pass to `startBridgeDefault({ dataDir })`.
- [ ] Add a preload script (contextIsolation is on) exposing `csb.pickDataFolder()` /
      `csb.getDataFolder()` over IPC; main uses `dialog.showOpenDialog` (native folder picker).
- [ ] A small Settings entry in the web UI (button) to pick/clear the folder; on change, persist +
      restart the in-process bridge with the new dir + reload. (Web build stays env-agnostic; the
      folder feature is desktop-only, degrades to `CSB_DATA_DIR` in the browser/dev.)

## Open questions for Inge
1. Scope now: **Stage 1+2 only** (unblock + explain; folder set via env/`CSB_DATA_DIR`), or **all three**
   (full in-app folder picker)? Stage 3 is the nice UX but adds preload/IPC + a Settings surface.
2. Settings placement: a small gear/menu item in the header, or a dedicated Settings view? (Only if we
   do Stage 3.)

## Review
All three stages implemented (Inge chose "all three"), v0.6.0.
- **Stage 1 (bridge):** `resolveDbPath({dbPath?,dataDir?})` + `resolveSettingsPath()` centralise
  location (precedence: dbPath → dataDir → CSB_DB_PATH → CSB_DATA_DIR → default). `SqliteDataSource`
  and `SettingsSource` take a `DataLocation`; `startBridgeDefault(port,{dataDir})` threads it through
  so DB + settings + candle DBs all follow one folder.
- **Stage 2 (UX):** `NoDataBanner` shows when the DB is missing (`!connected`) or empty (loaded &&
  connected && 0 symbols && 0 signals), naming the path + the `-f` fix.
- **Stage 3 (desktop):** new `preload.ts` exposes `window.csb` (get/pick/clear data folder) over IPC;
  `main.ts` persists `{dataDir}` in userData/config.json, passes it to the bridge, and on change
  restarts the in-process bridge + reloads. `esbuild.mjs` builds `preload.cjs` (CJS). Header gear
  opens `DataFolderSettings` (native picker on desktop; shows path + `CSB_DATA_DIR` hint in browser).
- Builds clean: web (tsc+vite), bridge (tsc), desktop (tsc + esbuild main.mjs + preload.cjs).
- Manual test still to do: package the desktop app, point it at a `-f` folder, confirm signals appear
  + banner behaviour. Bridge `CSB_DATA_DIR` testable in dev.
