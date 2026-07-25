# Data-folder UX: forgiving folder pick + version badge

## Why
Marius pointed the UI one folder too deep - at the engine's `Binance Futures` candle/WebView
subfolder - while `CryptoScanBot.db` actually lives in its parent `…\Futures`. Our code is correct
(`resolveDbPath = join(pickedFolder, "CryptoScanBot.db")`), but the folder pick is unforgiving: it
only checks the exact folder and just says "No scanner database found". Two easy traps combine: the
engine names the real data folder plainly (e.g. `Futures`) but also creates a same-looking
`Binance Futures` subfolder right next to the DB. We also can't tell which build a user is on when
they report an issue. Fix both, with the smallest possible change.

## Scope (keep it simple, minimal code)
Two items plus a shared bridge helper (nearby-DB lookup) that powers the banner. The folder picker
stays literal - it never overrides the user's choice; detection lives only in the banner, and the
user always clicks to apply.

### 0. Shared helper (bridge) - `findOracleDbDir(dir)`
- [x] In `@csb/bridge`, add a pure helper that, given a folder, returns the folder that actually
      contains `CryptoScanBot.db`, checking in order: the folder itself → its immediate subfolders →
      its parent. Returns `null` if none found. No behaviour change on its own; used by the banner.

### 1. Actionable "no database" banner (web + bridge)
- [x] Bridge: when the current data folder has no DB, surface a `suggestedDataDir` (result of
      `findOracleDbDir`) on `EngineInfo` (computed in `SqliteDataSource.info()`, only when the DB is
      absent; flows through `HybridDataSource` via `...base`).
- [x] Web `NoDataBanner`: when a suggestion exists, show a one-click button - "Use `<folder>`" -
      that on desktop calls the new `window.csb.setDataFolder(suggestion)` IPC, and in the
      browser/dev shows the exact path to set. Falls back to today's message when there's no suggestion.
- [x] The folder picker itself is unchanged: it persists exactly what the user selects (no silent
      re-pointing). The banner is the only place that suggests, and only the user's click applies it.

### 2. Version badge (web)
- [x] Surface the app version to the web (vite `define` `__APP_VERSION__` from `web/package.json`,
      baked into both dev and the packaged app).
- [x] Show it small/muted directly under "CryptoScanBot-ui" in `packages/web/src/components/Header.tsx`
      (e.g. `v0.8.0`), so a user's build is always visible when they report an issue.

## Verify
- [ ] Pick the too-deep `Binance Futures` subfolder → banner appears and offers "Use `…\Futures`";
      one click applies it and the UI comes online. The picker still stored exactly what was chosen.
- [ ] Pick a genuinely wrong folder (no DB anywhere near) → banner still shows, no false suggestion.
- [ ] Version badge shows the real version in dev and in a packaged build.
- [ ] `pnpm -r typecheck` + web build clean; no change to the default (no-dataDir) path behaviour.

## Notes
- Out of scope here (tracked separately): the desktop SignalR toggle.
- One PR, per-item commits.

## Review

Shipped as **v0.8.0**. Three items, minimal-code, one branch `feat/datafolder-ux` (per-item commits).

**What changed**
- `packages/bridge/src/sqlite-source.ts` - new pure `findOracleDbDir(dir)` (folder → subfolders →
  parent lookup for `CryptoScanBot.db`); `info()` now populates `suggestedDataDir` (only when the DB
  is absent). Exported from `packages/bridge/src/index.ts`.
- `packages/shared/src/index.ts` - `EngineInfo.suggestedDataDir?: string | null` (documented as
  "suggest only, never re-points"). `HybridDataSource` passes it through unchanged via `...base`.
- `packages/desktop/src/main.ts` + `preload.ts` - new `csb:setDataFolder` IPC + `window.csb.setDataFolder(dir)`
  (writes config, restarts the in-process bridge, reloads) so the banner button can apply a suggestion
  without opening a dialog. `packages/web/src/lib/desktop.ts` gains the `setDataFolder` type.
- `packages/web/src/components/NoDataBanner.tsx` - when `suggestedDataDir` exists, shows
  "Found a database in `<path>` - did you mean that folder?" + a **Use `<folder>`** button (desktop:
  one-click apply; dev: shows the path to set). No suggestion → the original `-f` hint + picker button.
- **Switching feedback (found in manual testing).** Applying a folder restarts the bridge + reloads
  (~1-2s) with no interim UI, so the click looked dead until it snapped to the new DB. The banner
  **Use** button and the Settings **Choose folder… / Reset** buttons now show an immediate
  "Switching…" spinner + disable, so the action has visible feedback. (`NoDataBanner.tsx` +
  `DataFolderSettings.tsx`, small `useState` pending flag each; the reload clears it.)
- `packages/web/vite.config.ts` + `vite-env.d.ts` - `__APP_VERSION__` define from `web/package.json`.
- `packages/web/src/components/Header.tsx` - `v{__APP_VERSION__}` small/muted under the title.
- All `package.json` versions bumped 0.7.0 → 0.8.0; CHANGELOG v0.8.0 (NEW then TECH).

**Verification (runtime, not just source)**
- `pnpm -r typecheck` clean; web build clean; desktop main esbuild clean; `ggshield` clean.
- Bridge runtime test against Marius' exact layout (`…/Futures/CryptoScanBot.db` + sibling
  `Binance Futures/` subfolder): 10/10 asserts pass - too-deep pick → suggests `…/Futures`,
  too-shallow → suggests the `Futures` subfolder, exact → itself, genuinely-wrong → `null` (no false
  suggestion); `info()` reports `dbPresent=false` + the right `suggestedDataDir` when off, and
  `dbPresent=true` + `null` suggestion when correct.
- Version badge: `v0.8.0` confirmed baked into the built JS bundle.

**Design note (per Inge's call):** dropped the earlier idea of the folder picker silently
auto-correcting to the parent. The picker stays literal; the only place that ever suggests is the
banner, and nothing is applied without the user's click.

**Not in this PR (tracked separately in `project-ui-followups`):** the desktop SignalR toggle, and #3
(ask Marius for backfill-on-connect + periodic barometer/price broadcast).
