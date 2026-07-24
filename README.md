# CryptoScanBot-ui

A cross-platform (macOS / Linux / Windows) scanner UI - web app **and** desktop app (Electron) - built
on top of Marius' **CryptoScanBot C# engine**. The C# engine does the scanning (candle sync, indicators,
signals, trend, barometer) and writes a SQLite database; this app is a modern UI/UX on top of it.

## Architecture

```
              ┌─────────────── ScannerDataSource (one interface) ───────────────┐
  React UI ── │  Phase A: SqliteDataSource  (reads the engine's SQLite oracle)   │
 (web + Electron) │  Phase B: HttpDataSource   (talks to a headless C# host)     │
              └──────────────────────────────────────────────────────────────────┘
                         served over localhost by the `bridge` (Node HTTP + WS)
```

The UI never knows where data comes from - it talks to the local **bridge**. Today the bridge reads the
C# engine's SQLite oracle (read-only). Later, the same bridge swaps to a headless C# host for live
control (start/stop/settings) without touching the UI.

## Packages
- `@csb/shared` - the data contract (`ScannerDataSource`, DTOs). No IO.
- `@csb/bridge` - Node HTTP + WebSocket server; owns the active `ScannerDataSource`.
- `@csb/web` - React UI (Vite). Talks to the bridge over `localhost`.
- `@csb/desktop` - Electron shell: spawns the bridge (and later the C# engine), loads the web UI.

## Dev
```sh
pnpm install
pnpm dev            # bridge + web (browser at the Vite URL)
pnpm dev:desktop    # Electron shell
```
Requires the C# engine running (writes `~/Library/Application Support/CryptoScanBot/CryptoScanBot.db`
on macOS). See the engine repo for building/running it: <https://github.com/CryptoMarius/CryptoScanBot>
