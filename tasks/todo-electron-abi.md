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
