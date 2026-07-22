# Building the desktop app

The desktop app (`@csb/desktop`) is an Electron shell that runs the bridge in-process and shows
our web UI in a native window. It reads the C# engine's SQLite oracle - so the engine must be
running (writing its DB) for the app to show live data.

## What ships where

- **main process** - bundled by esbuild into `dist/main.mjs` (ESM, so `ccxt` resolves its ESM build).
- **web UI** - built by Vite into `packages/web/dist`, copied into the app and served by the
  in-process bridge at `http://127.0.0.1:4319` (same-origin: no CORS, no proxy).
- **native module** - `better-sqlite3`, rebuilt for Electron's ABI by electron-builder. It resolves
  a prebuilt binary per platform, so no C/C++ compiler is needed on a normal setup.

## macOS (.dmg)

```sh
pnpm --filter @csb/desktop dist
```

Output: `packages/desktop/release/CryptoScanBot-<version>-arm64.dmg` (Apple Silicon).

Unsigned for now, so the first launch needs **right-click > Open** once to get past Gatekeeper
(a normal double-click shows "unidentified developer"). Apple notarization is a later step.

## Windows (.exe) - build ON Windows

A Windows `.exe` **cannot be produced from macOS**: `better-sqlite3` is a native module and
node-gyp cannot cross-compile a win32 binary from darwin. Build it on Windows, where
`better-sqlite3` resolves a prebuilt win32-x64 binary (still no compiler needed).

Two ways:

### 1. GitHub Actions (recommended)

`.github/workflows/build.yml` builds both macOS and Windows on their own runners and uploads the
installers as artifacts. Trigger it by pushing a `v*` tag or running the workflow manually
(**Actions > build > Run workflow**). Download the `cryptoscanbot-windows-latest` artifact.

### 2. On a Windows machine

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @csb/desktop dist
```

Outputs in `packages/desktop/release`:
- `CryptoScanBot Setup <version>.exe` - NSIS installer (choose install dir, Start-menu shortcut).
- `CryptoScanBot <version>.exe` - portable, runs without installing.

On Windows the engine writes its DB to `%APPDATA%/CryptoScanBot/CryptoScanBot.db`, which the bridge
reads automatically - so this is exactly what Marius needs to run **his** engine with **our** UI.

## Notes

- `bufferutil` / `utf-8-validate` (optional `ws`/`ccxt` native perf addons) are stripped at install
  by `.pnpmfile.cjs` - they force an unnecessary native compile and we don't need them.
- The C# engine is not bundled yet (Step 2). Today the app reads a running engine's oracle DB.

### After a local macOS build: restore the dev bridge

electron-builder rebuilds `better-sqlite3` against **Electron's** ABI, in the shared pnpm store.
That breaks the plain-Node dev bridge (`ERR_DLOPEN_FAILED`, `NODE_MODULE_VERSION` mismatch). The
packaged `.app` has its own copy, so restoring the store copy for Node is safe:

```sh
( cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 \
  && rm -f build/Release/better_sqlite3.node && npx --yes prebuild-install -r node )
```

(CI is unaffected - each runner is a fresh checkout, and only builds one target.)
