# Clear stale signals on exchange switch

## Problem

When the C# scanner switches active exchange (e.g. Bybit Spot -> Binance Futures) it **wipes its
Signal table** and starts fresh for the new exchange. Our UI kept showing the OLD exchange's signals
until a full page reload.

## Root cause

`packages/web/src/App.tsx` accumulates signals in an in-memory map keyed by `id` and only ever ADDS
(`byId.set` in the `'signals'` WS handler) - it never removes rows that no longer exist in the DB.
The bridge's `poll()` likewise only emits *new* rows (`Id > lastId`), never deletions. So a wiped
Signal table never propagates; the stale rows linger client-side.

The symbol list already handles this (it re-fetches filtered by `info.exchange` on change). Signals
just never got the same treatment.

Note: `Signal.Id` is `INTEGER primary key autoincrement` and `sqlite_sequence` survives a `DELETE`, so
new post-switch signals get Ids ABOVE the old max - the bridge poll still picks them up. No bridge
change is needed; this is purely a UI staleness bug.

## Fix (UI-only, minimal)

- [x] **Display filter**: derive `activeSignals = signals` filtered to `info.exchange`, and use it for
      the table, counts (today), filter-option catalogs and the `emptyDb` check. Stale cross-exchange
      rows disappear instantly when the header exchange flips.
- [x] **Refetch-and-replace on switch**: on `info.exchange` change (after the first known value),
      re-fetch signals and REPLACE the list, so wiped rows leave memory and we load the new exchange's
      current set. Mirrors the existing symbols effect.

## Follow-ups found while testing the switch

- [x] **Empty-DB banner false positive.** During a switch the DB is transiently empty for the new
      exchange (Signal table wiped + symbols still backfilling for ~1 min), which tripped the
      "scanner database is empty / wrong -f folder" banner. Guard it with an `everHadData` latch: once
      we've seen real data this session, later emptiness is a switch/backfill, not a misconfig. A
      genuinely wrong folder at startup still shows the banner (we never saw data). Resets on reload.
- [x] **Interval filter hid SMC signals (fix A).** The engine's scan intervals (e.g. 1m/2m/3m) were
      used as the default interval filter, but SMC/zone strategies (smc/dlz/fvg, enum >=1000) emit on
      higher timeframes (e.g. a 1h OrderBlock signal). Those got filtered out yet still counted in
      "today" -> "0 shown - 1 today". Fix: `scannedFilters` no longer restricts intervals (default =
      all); strategies still default to the enabled set (they map cleanly, enabled == emitted).

## Verify

- [ ] Switch the scanner Bybit Spot -> Binance Futures: the old Bybit signals disappear (no reload),
      and new Binance signals stream in.
- [ ] Switch to OKX: no empty-DB banner flashes during the ~1 min backfill.
- [ ] A higher-TF SMC signal (e.g. 1h OrderBlock USDCUSDT) is now visible, and "shown" matches "today".
- [ ] `pnpm --filter @csb/web typecheck` clean.

## Review

(to fill in)
