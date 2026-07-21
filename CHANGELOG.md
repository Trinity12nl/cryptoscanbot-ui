# Changelog

All notable changes to CryptoScanBot-app are documented here.
Format: version - change type (NEW / IMPROVED / FIX / TECH) - what changed.

## [Unreleased]

### 0.1.0 - 2026-07-21
- **NEW** Project bootstrapped. Cross-platform scanner UI (web + desktop via Electron) built on top of
  Marius' CryptoScanBot C# engine (the avalonia branch, which compiles + runs native on macOS and
  writes a SQLite oracle). Goal: our own modern UI/UX, off UTM, off the old Windows look.
- **TECH** Monorepo (pnpm): `shared` (data contract), `bridge` (Node HTTP/WS reading the engine's
  SQLite), `web` (React UI), `desktop` (Electron shell). Phase B = read-only over the SQLite oracle;
  Phase A (later) swaps the bridge's data source to a headless C# host, UI unchanged.
