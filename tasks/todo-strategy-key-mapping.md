# Strategy-key mapping: signals hidden because engine settings keys don't match display names

## Problem
Signals for some strategies (noticed: USDCUSDT / USD1USDT, both `BbmaOmni`) never appear in the UI.
Root cause: the default signal filter = "what the engine is scanning" = `settings.enabledStrategies`,
which the bridge derives by lowercasing the engine settings-file strategy keys and matching them to
lowercased display names (`STRATEGY_NAME_BY_LOWER`). The engine keys don't match that way:

- **Punctuation:** `bbma.omni` vs `bbmaomni`, `stobb.multi` vs `stobbmulti`, `choch.primary` vs
  `chochprimary`, `ichimoku.kumo.breakout`, `nwe.bb`, `nwe.np`, `storsi.multi`, `choch.*.pullback`.
- **True aliases:** `dlz`->DominantLevel, `dlz.near`->DominantLevelNear, `fvg`->FairValueGap,
  `smc`->OrderBlock, `smc.rejection`->OrderBlockRejection.

Unmatched keys drop out of `enabledStrategies`, so those strategies aren't ticked by default and their
signals are hidden. (Simple keys like `sbm1`/`stobb`/`jump` happen to match, which is why most show.)

Secondary bug: `STRATEGY_NAMES` is missing 4 enums the engine can emit -> those signals would render
as `#26` etc. and never match a filter option:
`NweNp=26`, `NweBb=27`, `BbSqueeze=55`, `OrderBlockRejection=1006`.

## Source of truth
The avalonia engine registers every key->enum pair in its plugins
(`new StrategyRegistration(CryptoSignalStrategy.BbmaOmni, "bbma.omni", ...)`) and the enum ids live in
`CryptoScanner.Core/Enums/CryptoSignalStrategy.cs`. Verified the full settings vocabulary against both.
Only 5 keys are non-normalizable aliases; the rest are the punctuation-stripped display name.

## Plan
- [ ] `packages/shared/src/index.ts`
  - [ ] Add the 4 missing entries to `STRATEGY_NAMES` (26 NweNp, 27 NweBb, 55 BbSqueeze, 1006 OrderBlockRejection).
  - [ ] Add `strategyIdFromSettingsKey(key)` + `strategyNameFromSettingsKey(key)`: normalise the key
        (lowercase, strip non-alphanumerics) and match it against normalised display names, with a
        small alias table for the 5 non-normalizable keys (`dlz`, `dlz.near`, `fvg`, `smc`,
        `smc.rejection`). Ported from the C# StrategyRegistration list.
- [ ] `packages/bridge/src/settings-source.ts`
  - [ ] Replace the `STRATEGY_NAME_BY_LOWER` heuristic with `strategyNameFromSettingsKey` when building
        `enabledStrategies`.
- [ ] Typecheck + build. Verify against the live default DB: `enabledStrategies` now includes
      `BbmaOmni`, so the two signals show by default.
- [ ] Manual test (Inge): the USDCUSDT / USD1USDT signals appear without ticking anything.

## Review (2026-07-25)

**Implemented.**
- `packages/shared/src/index.ts`: added `26 NweNp, 27 NweBb, 55 BbSqueeze, 1006 OrderBlockRejection`
  to `STRATEGY_NAMES`; added `strategyIdFromSettingsKey` / `strategyNameFromSettingsKey` - normalise
  the key (lowercase + strip non-alphanumerics) to match display names, plus a 5-entry alias map
  (`dlz`, `dlz.near`, `fvg`, `smc`, `smc.rejection`) ported from the C# StrategyRegistration list.
- `packages/bridge/src/settings-source.ts`: `enabledStrategies` now uses `strategyNameFromSettingsKey`
  instead of the lowercased-display-name heuristic (and de-dupes the result).

**Verified.** Ran all 27 real settings keys from the live default DB through the mapping - every one
resolves, `(none)` unmapped, incl. `bbma.omni -> BbmaOmni`. `pnpm -r typecheck` clean across all
packages. `@csb/shared` is consumed as source, so the dev bridge picks this up on restart (the
installed v0.6.1 app needs a rebuild to include it).

**Manual test:** restart the dev bridge, confirm USDCUSDT / USD1USDT (BbmaOmni) show by default.
