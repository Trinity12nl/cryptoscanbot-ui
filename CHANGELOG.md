# Changelog

All notable changes to **CryptoScanBot-app** (this UI + bridge) are documented here.
Format: change type - **NEW** / **IMPROVED** / **FIX** / **TECH** - and what changed.
Uses [semantic versioning](https://semver.org/).

> **Note on the engine.** This app is the UI/UX layer; the scanning **engine is Marius' C#
> CryptoScanBot** (the `avalonia` branch), which has its **own** changelog and versioning upstream.
> We track that engine but do not own it, so this changelog covers only the app (bridge + web +
> desktop). Engine repo (link may change): <https://github.com/CryptoMarius/CryptoScanBot>.

## [Unreleased]

### 0.1.0 - 2026-07-21
- **NEW** Project bootstrapped as a fresh repo. Cross-platform scanner UI (web + desktop via Electron)
  on top of the C# engine, which compiles + runs native on macOS and writes a SQLite oracle. Goal:
  our own modern UI/UX, off UTM, off the old Windows look.
- **NEW** Live signal grid: sortable, **column show/hide picker** (All / Default / None), drag-to-reorder
  columns, layout persisted to localStorage, new-signal flash, row-click opens the TradingView chart.
- **NEW** Extended columns beyond the C# grid, hidden by default in the picker: RSI, Stoch, Stoch-Signal,
  MACD histogram, Effective %, Barcode, Text, Exchange, Id. Trend shown as two columns - **Dow** and
  **BOS** - with a ⚡ marker where they disagree.
- **NEW** Filters: strategy + interval multi-selects and a long/short/all side toggle.
- **NEW** Live **Change** column - live price vs the signal price (%), coloured by whether the move
  favours the position (a drop is a gain for a short). Fed by a public exchange ticker feed in the
  bridge; will later move to the headless C# host behind the same data seam.
- **NEW** Light / dark theme following the OS by default, with a manual toggle that is remembered.
- **TECH** Monorepo (pnpm): `shared` (the `ScannerDataSource` data contract + DTOs - the seam that
  keeps Phase A a drop-in backend swap), `bridge` (Node HTTP/WS reading the engine's SQLite oracle +
  a ccxt ticker feed), `web` (React 19 + Vite 6 + Tailwind), `desktop` (Electron shell, next).
- **TECH** Strategy names use the avalonia branch's enum ids (the older 2.0.x ids were renumbered).
