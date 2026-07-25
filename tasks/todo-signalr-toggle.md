# Desktop SignalR toggle (idiot-proof live link)

## Why
Turning on the Phase B live link today means (a) `CSB_SIGNALR=1` env on the bridge - which a
packaged double-clicked app has no way to set - and (b) `General.SignalREnabled=true` in the C#
engine's `CryptoScanBot-settings.json`. Both are invisible/manual. Goal: a switch in the desktop UI
so a user never touches env vars, and clear on-screen status for the engine side.

## Scope (keep it simple, minimal code)
Two halves, only the first is fully ours to control:

**A. Bridge-side connect (fully in our control).** Persist a `signalrEnabled` flag (+ `signalrPort`,
default 5200) in the desktop config, and (re)start the in-process bridge with `signalrUrl` when on -
exactly the data-folder restart+reload+"Switching…" pattern. This is what a packaged app can't do via
env today.

**B. Engine-side awareness (read + guide, don't fight the engine).** The link only actually connects
when the engine also has `SignalREnabled=true` and is running. We READ the engine's setting from its
JSON (safe) and show live status; we do NOT silently rewrite the engine's file while it may be running
(it rewrites on exit and would clobber us). Optional later: an explicit "write it for me (scanner must
be quit)" button, clearly gated.

### 0. Bridge: surface SignalR status on EngineInfo
- [x] `EngineInfo` gains `signalrEnabled` (bridge is attempting the hub) + `signalrConnected` (hub
      live now). `HybridDataSource.info()` sets enabled=true, connected=`signalr.isConnected()`;
      `SqliteDataSource.info()` sets both false. Info-poll broadcast key includes them so the header
      updates on connect/disconnect.
- [x] (B) `SettingsSource.getEngineSignalr()` reads the engine's own `General.SignalREnabled` /
      `SignalRPort` from its settings JSON; `server.readInfo` adds it as `EngineInfo.engineSignalrEnabled`.

### 1. Desktop: persist + apply the toggle
- [x] Config gains `signalrEnabled?: boolean` + `signalrPort?: number`; a merging `updateConfig`
      helper so writing one setting never wipes the others (also applied to the data-folder handlers).
      `startOrRestartBridge` passes `signalrUrl = http://localhost:<port>/signalr/signals` when enabled.
- [x] IPC `csb:getSignalr` / `csb:setSignalr(enabled)` (writes config, restarts bridge, reloads).
      Preload + `lib/desktop.ts` `SignalrState` types.

### 2. Web: the toggle UI
- [x] `SignalRToggle` rendered in the Settings modal (gear): a switch bound to
      `window.csb.getSignalr()/setSignalr()`, a status line from `EngineInfo`
      (off / live / enabled-but-waiting with an engine-side hint), and a "Switching…" pending state.
      `DataFolderSettings` now takes `info` and passes it through; `Header` updated.
- [x] Desktop-only; in dev/browser it shows the `CSB_SIGNALR=1` fallback note.

## Verify
- [ ] Toggle off → bridge is Phase-A (no hub); on → `[bridge] Phase B … enabled` and, with the engine
      hub up, `signalrConnected: true`; header dot reflects real liveness.
- [ ] Toggle survives restart (persisted in config). `pnpm -r typecheck` + builds clean.
- [ ] Enabled but engine hub down → clear "waiting for scanner" hint, not a scary error.

## Notes
- Reuse the data-folder restart+reload + "Switching…" pending pattern (v0.8.0).
- Do NOT launch Inge's C# scanner from the agent shell (TCC disk-IO error). She starts it herself.
- One PR, per-item commits.

## Review

Implemented on branch `feat/signalr-toggle` (not yet committed - awaiting manual test).

**What changed**
- `packages/shared/src/index.ts` - `EngineInfo` += `signalrEnabled`, `signalrConnected`,
  `engineSignalrEnabled` (all optional).
- `packages/bridge/src/sqlite-source.ts` - Phase A `info()` sets both signalr fields false.
- `packages/bridge/src/hybrid-source.ts` - `info()` sets `signalrEnabled: true` +
  `signalrConnected: signalr.isConnected()`.
- `packages/bridge/src/settings-source.ts` - `RawSettings.General` += `SignalREnabled`/`SignalRPort`;
  new read-only `getEngineSignalr()`.
- `packages/bridge/src/server.ts` - `readInfo` adds `engineSignalrEnabled`; info-poll broadcast key
  now includes signalr state.
- `packages/desktop/src/main.ts` - config += `signalrEnabled`/`signalrPort`; `updateConfig` merge
  helper (data-folder handlers switched to it so they don't wipe the toggle); `startOrRestartBridge`
  passes `signalrUrl` when enabled; `csb:getSignalr` / `csb:setSignalr` IPC.
- `packages/desktop/src/preload.ts` + `packages/web/src/lib/desktop.ts` - `SignalrState` +
  `getSignalr`/`setSignalr`.
- `packages/web/src/components/SignalRToggle.tsx` (NEW) - the switch + status line.
- `packages/web/src/components/DataFolderSettings.tsx` - takes `info`, renders `SignalRToggle`.
- `packages/web/src/components/Header.tsx` - passes `info` to the Settings modal.

**Verification (runtime, not just source)**
- `pnpm -r typecheck` clean; web build + desktop-main build clean; `csb:setSignalr`/`getSignalr`
  present in compiled `main.mjs`/`preload.cjs`.
- Bridge unit test (6/6): `getEngineSignalr()` reads enabled/port from a settings JSON; Phase A
  `info()` → signalr fields false; Phase B `HybridDataSource.info()` → `signalrEnabled: true`,
  `signalrConnected: false` when the hub is down.

**Design note:** the toggle is our BRIDGE-side switch only - it never rewrites the engine's settings
JSON (the engine owns it and rewrites on exit). When enabled-but-not-connected, the status line tells
the user to enable SignalR in the scanner + restart it, reading the engine's own `SignalREnabled` to
say whether the scanner side is on.

**Found + fixed during manual testing (all in v0.8.1):**
- **`ws`/`@microsoft/signalr` packaging.** Enabling SignalR in the packaged Electron main threw
  `Cannot find module 'ws'` - its Node transports (ws, eventsource, fetch-cookie→tough-cookie…) load
  via dynamic requires esbuild can't bundle. Fixed by marking `@microsoft/signalr` external in
  `esbuild.mjs` + adding it as a real `@csb/desktop` dependency (Node resolves its subtree; matches
  ccxt/better-sqlite3). Would have hit the real `.dmg` too.
- **No page reload on toggle.** The live link doesn't change the dataset, so `csb:setSignalr` restarts
  the bridge WITHOUT `webContents.reload()`; the status updates in place. (`SignalRToggle` reflects the
  new value from the IPC result.)
- **Status stuck until reload - two bugs.** (a) The bridge only pushed info on its 5s poll → added
  `onInfoChange` so the hub connect/drop pushes immediately. (b) A bridge restart left the UI's socket
  on the OLD instance (`http.close()`/`wss.close()` keep existing sockets) → `server.close()` now
  `terminate()`s clients so they reconnect to the NEW bridge.
- **Header consolidation (Inge's call).** Dropped the redundant "Engine ●" dot; the status pill is now
  the single source of truth (**Live signals / connecting… / Polling (DB) / Offline / reconnecting…**),
  with the exchange shown plainly beside it. Labels are jargon-free ("Live signals", not "SignalR");
  the mechanism stays in the hover tooltip.

**Shipped as v0.8.1** (manual test confirmed: toggle on with the hub up → "Live signals"; rapid
off/on tracks correctly in place; persists across restart).
