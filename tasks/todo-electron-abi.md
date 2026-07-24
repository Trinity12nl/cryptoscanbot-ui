# Packaged app: better-sqlite3 Electron ABI (blocker for the desktop build)

## Problem
The packaged Electron app crashes at startup (no window): the in-process bridge can't load
better-sqlite3 - it's built for Node's ABI (NODE_MODULE_VERSION 127), but Electron 33 needs 130
("compiled against a different Node.js version"). Because the bridge can't serve, `loadURL` fails and
the window never shows.

## Why it's hard
- **No Electron prebuilt** for better-sqlite3@11.10.0 (prebuild-install only fetches Node prebuilts).
- **Compiling from source needs a node-gyp toolchain the runners lack:**
  - macOS runner (and Inge's Mac, Python 3.14): `ModuleNotFoundError: No module named 'distutils'`
    (removed in Python 3.12+; node-gyp 9.4.1 needs it).
  - Windows runner: `Could not find any Visual Studio installation to use`.
- `buildDependenciesFromSource: true` therefore BREAKS both CI runners (reverted).
- pnpm makes it worse: one shared store copy of better-sqlite3, but dev (Node 127) and the packaged
  app (Electron 130) need different ABIs from that one copy.

## Candidate fixes (pick in a fresh, focused session)
1. **Fix the CI toolchain, then buildDependenciesFromSource:**
   - macOS step: `pip install setuptools` (restores distutils) OR pin Python <=3.11 via
     `actions/setup-python`.
   - Windows step: `ilammy/msvc-dev-cmd` (or ensure VS build tools) + maybe a newer node-gyp.
   - Then compiling better-sqlite3 for Electron gives ABI 130.
2. **Use @electron/rebuild explicitly** in the workflow before `electron-builder` (with the toolchain
   from #1), instead of relying on npmRebuild.
3. **Swap the SQLite driver** to one with Electron prebuilds or a prebuilt-friendly setup
   (e.g. a node-sqlite3 variant), avoiding local compilation entirely.
4. **Local dev vs packaged ABI conflict:** ensure the packaged rebuild targets the app bundle, not the
   shared pnpm store (so it doesn't break the Node dev bridge). electron-builder normally handles this;
   verify under pnpm.

## Status
- Feature code (custom data folder, PR #10, v0.6.0) is DONE and correct - this ABI issue is a separate
  packaging/toolchain problem, pre-existing for any local/CI Mac desktop build.
- CI reverted to `npmRebuild: true` only (builds green again, but the produced dmg likely still has the
  Node ABI = won't run until this is fixed).
- Testable meanwhile in the BROWSER: the "No data" banner + the data-folder gear render; the
  folder-repoint itself is testable in dev via `CSB_DATA_DIR` on the bridge.

---

## SOLUTION FOUND (2026-07-24) - no compiler needed

The whole premise that we must "compile from source" was wrong. **better-sqlite3 v11.10.0 publishes
Electron prebuilts**, including `electron-v130` (ABI 130 = Electron 33) for BOTH targets we need:
`darwin-arm64` and `win32-x64`. So we just download the Electron prebuilt instead of compiling.

Proven empirically on this Mac:
- `@electron/rebuild -v 33.4.11 -o better-sqlite3` finished in seconds (no node-gyp compile).
- The resulting store binary's SHA256 is byte-identical to the cached
  `better-sqlite3-v11.10.0-electron-v130-darwin-arm64` prebuilt, and different from the node-v127 one.
- => zero toolchain used (no distutils, no MSVC). The same prebuilt exists for win32-x64, so the
  identical step fixes the Windows runner too.

Why the old setup failed: the CI step `pnpm rebuild better-sqlite3` produced the **Node** ABI (127),
and electron-builder's `npmRebuild` under pnpm's symlinked tree didn't reliably override it -> the
packaged binary stayed Node-ABI and the window never showed.

### The fix (deterministic, explicit)
1. Add `@electron/rebuild` as an explicit devDependency of `@csb/desktop` (so the `electron-rebuild`
   CLI resolves - it was only transitive via electron-builder).
2. `@csb/desktop` gets a `rebuild:native` script: `electron-rebuild -f -o better-sqlite3` (downloads
   the Electron prebuilt into node_modules).
3. `dist` runs `rebuild:native` before `electron-builder`, so local + CI are identical.
4. `electron-builder.yml`: `npmRebuild: false` - we've already placed the correct-ABI binary, so
   electron-builder just packages it (no flaky pnpm rebuild).
5. CI `build.yml`: replace the `pnpm rebuild better-sqlite3` (Node ABI) step with the Electron rebuild.

### pnpm single-copy caveat (local dev)
There's one shared store copy of better-sqlite3. Building a dmg flips it to Electron ABI 130, which
breaks the **Node** dev bridge until you flip it back with `pnpm rebuild better-sqlite3`. Non-issue in
CI (fresh runner, build-only). Documented in BUILD.md.

## Checklist
- [x] Add `@electron/rebuild` devDep + `rebuild:native` script to `packages/desktop/package.json`
- [x] Wire `rebuild:native` into the `dist` script
- [x] `npmRebuild: false` in `electron-builder.yml` (+ update comment)
- [x] Update CI `build.yml` step to the Electron rebuild
- [x] Validate the mac `.dmg` locally - packaged binary SHA == electron-v130 prebuilt (byte-identical)
- [x] Document the dev/build ABI flip in BUILD.md
- [x] Restore dev bridge (Node ABI 127) after local validation
- [x] Version bump (0.6.1) + CHANGELOG
- [ ] MANUAL: launch the built `.dmg`, confirm the window shows + data loads (Inge)
- [ ] PR + tag `v0.6.1` to trigger the release build (mac + win)

## Review (2026-07-24)

**Root cause was a false premise.** The plan assumed better-sqlite3 had no Electron prebuilt and had
to be compiled from source (needing distutils/MSVC the runners lack). In fact v11.10.0 publishes an
`electron-v130` prebuilt for both `darwin-arm64` and `win32-x64`. The old CI produced the **Node**
ABI (`pnpm rebuild better-sqlite3`) and electron-builder's `npmRebuild` under pnpm's symlinked store
didn't reliably override it, so the packaged binary was Node-ABI and the window never showed.

**Fix (no toolchain):** an explicit `electron-rebuild -f -o better-sqlite3` step downloads the Electron
prebuilt before packaging; electron-builder set to `npmRebuild: false` just packages it.

**Files changed:**
- `packages/desktop/package.json` - `@electron/rebuild` devDep, `rebuild:native` script, wired into `dist`.
- `packages/desktop/electron-builder.yml` - `npmRebuild: false` + explanatory comment.
- `.github/workflows/build.yml` - Electron-prebuilt rebuild step (replaces Node-ABI `pnpm rebuild`).
- `packages/desktop/BUILD.md` - corrected the native-module + dev-restore notes.
- `CHANGELOG.md` + all package versions -> `0.6.1`.

**Proof:** `pnpm --filter @csb/desktop dist` produced `CryptoScanBot-ui-0.6.1-arm64.dmg`; the
`better_sqlite3.node` inside the `.app` is SHA256-identical to better-sqlite3's upstream
`electron-v130-darwin-arm64` prebuilt. electron-builder logged `skipped dependencies rebuild
reason=npmRebuild is set to false`. Dev bridge restored to Node ABI afterward. Windows can't be built
on macOS but uses the identical step + the `electron-v130-win32-x64` prebuilt on its runner.
