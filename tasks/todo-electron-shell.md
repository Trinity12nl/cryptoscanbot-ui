# Electron shell (the desktop app)

Goal: prove the packaging pipeline works - our UI as a native, double-clickable macOS app
that launches on its own, runs the bridge inside, reads the C# engine's SQLite oracle, and
shows live signals. Once this exists, we keep doing PoC work in the browser (Vite HMR) and
just **rebuild the `.dmg`** whenever we want a shareable snapshot.

## Key facts / constraints

- The bridge is plain Node (better-sqlite3 + ccxt + ws). Electron's main process **is** Node,
  so we run the bridge **in-process** - no separate spawned Node runtime. The renderer (our web
  UI) hits `http://127.0.0.1:4319` exactly as it does in dev.
- `better-sqlite3` is a native module and must be built for **Electron's** ABI, not system Node.
  electron-builder rebuilds it at package time (`npmRebuild` / app-deps rebuild).
- The C# engine is still the **Avalonia GUI app** (apphost `CryptoScanBot`, ~197 MB self-contained
  `osx-arm64` publish). There is **no headless mode yet** (that is Phase A / the Marius talk). So for
  now the engine runs as it does today, with its own window. We do NOT bundle/spawn it in step 1.

## Plan

### Step 1 - the shell (prove native launch + packaging)  ← do first
- [ ] `packages/desktop/package.json` - Electron + electron-builder, scripts `dev` / `build` / `dist`.
- [ ] `src/main.ts` - main process: start the bridge in-process (import `startBridge` +
      `SqliteDataSource` + `TickerSource` from `@csb/bridge`), then open a `BrowserWindow`.
      - dev: load `http://localhost:5319` (Vite HMR).
      - packaged: load the built `@csb/web` `dist/index.html`.
- [ ] `src/preload.ts` - minimal, contextIsolation on (no node in the renderer; it only does HTTP/WS).
- [ ] App icon - our own (replaces the ugly generic "exec" icon). Simple placeholder now, refine later.
- [ ] `electron-builder` config - target `dmg` (arm64), rebuild `better-sqlite3` for Electron.
- [x] Verify: `pnpm --filter @csb/desktop dev` opens our UI in an Electron window with live signals.
      DONE 2026-07-21 - window launches, loads Vite (HMR), live grid. Fixed ccxt-in-Electron by
      making the main an ESM bundle (esbuild format esm, .mjs, __dirname banner).
- [ ] Verify: `pnpm --filter @csb/desktop dist` produces a `.dmg` that launches on its own
      (engine running separately, as today).

### Step 1b - deferred to the scheduled resume (do these when the trigger fires)
Requested by Inge 2026-07-21, to run after her quota reset:
- [ ] **App icon** - a fancy, shiny version of the green lightning bolt (⚡) used in the app.
      Produce `build/icon.png` (1024x1024, macOS-style rounded-square, emerald gradient, glossy
      highlight) + generate `.icns` (mac) and `.ico` (Windows) if electron-builder needs them.
      lucide "zap" is the shape reference; make it richer (gradient + glow + shine), not flat.
- [ ] **macOS `.dmg`** - `pnpm --filter @csb/desktop dist`; confirm it launches standalone and the
      in-process bridge serves the built UI same-origin (http://127.0.0.1:4319). Exercises npmRebuild
      of better-sqlite3 for Electron's ABI - watch for native-module build errors.
- [ ] **Windows `.exe`** - add an nsis (installer) + portable target to electron-builder for win/x64,
      so Marius can run HIS engine with OUR UI. NOTE: cross-building a Windows exe from macOS that
      contains a NATIVE module (better-sqlite3) is the hard part - node-gyp can't cross-compile it.
      Options to evaluate when it fires: (a) build on Windows / CI (GitHub Actions windows-latest),
      (b) fetch a prebuilt better-sqlite3 win32-x64 binary (prebuild-install) so no compile is needed,
      (c) document a Windows-run build command. Prefer (b)+CI. Deliver at least a working config +
      clear instructions even if a mac-local win build isn't fully producible.
- [ ] **Sticky table header** (UI) - `SignalTable.tsx`: make the `<thead>` sticky so column labels
      stay visible when scrolling the grid. `sticky top-0 z-10` on the header cells + a solid
      background (bg-white/dark:bg-zinc-900) + a bottom border; ensure the scroll container is the
      table wrapper, not the page. Small, do first (quick win) or alongside the icon.

### Step 2 - bundle the engine (standalone, one double-click)  ← later, optional for now
- [ ] Bundle the `osx-arm64` engine publish inside the app (extraResources).
- [ ] Spawn it as a child process on launch; stop it on quit. (Its Avalonia window still appears -
      a known Phase-B artifact; Phase A headless removes it.)
- [ ] This is what other Mac users need (unsigned `.dmg` + "right-click > Open" manual).

## Notes / decisions
- Bridge stays a library import here; `@csb/bridge` already exports `startBridge`. May need to add a
  tiny `startBridgeDefault()` (wire SqliteDataSource + TickerSource + exchange sync) so both the CLI
  entry (`index.ts`) and Electron main share one setup path - avoid duplicating index.ts logic.
- Unsigned for now (accept the Gatekeeper "right-click > Open"); Apple notarization later.
- We develop in the browser; the packaged app is a release snapshot, not a dev loop.

## Review
(to fill in after implementation)
