# Fix: interval filter vs OrderBlock's 1h + reset logic

Inge's report (2026-07-30): she scans intervals **1m/2m/3m** with strategies **Sbm1/2/3, Stobb, SMC
(OrderBlock)**. OrderBlock analyses the **1h** block but fires on the 1m trigger candle, so it emits
signals labelled `1h`. The interval filter mishandles this.

## Bugs + root causes (verified)
1. **Selection reverts to All.** `App.tsx:110` (inside the `settings` WS handler) calls
   `setFilters(scannedFilters(ev.settings))` whenever `configSignature` changes. OrderBlock/config churn
   flips the signature, wiping the user's interval selection. The `MultiSelect` component itself is fine
   (controlled, toggles correctly).
2. **Defaults to "All" and Reset -> "All".** `scannedFilters()` hardcodes `intervals: []` (old
   workaround), so the interval filter never defaults to the scanned set the way the strategy filter
   does, and `onReset` (`App.tsx:257`) -> `scannedFilters(settings)` -> `[]` = All.
3. **`1h` shown "not scanning".** The scanning set = `settings.enabledIntervals` = `["1m","2m","3m"]`
   (from `Signal.Long/Short.Interval`); it does NOT include OrderBlock's implied `1h`. So the dropdown
   dims `1h` as "not scanning" even though OrderBlock DOES emit 1h signals - and that's exactly why the
   `intervals: []` workaround exists (filtering by enabledIntervals hid the valid 1h OrderBlock rows).

Verified live: `/api/settings` -> `enabledIntervals: ["1m","2m","3m"]`,
`enabledStrategies: ["Sbm1","Sbm2","Sbm3","OrderBlock","Stobb"]`. OrderBlock signals carry interval `1h`
(e.g. signal 19360). `formatCandleRange`/CloseDate handled separately in PR #31.

## >>> DO FIRST: examine the OLD app - Inge says we already solved this there (incl. reset logic)
Old app = `CryptoScanBot-new/packages/web/src/`. Read these BEFORE designing the fix:
- `components/FilterBar.tsx`
- `components/MultiSelect.tsx`
- `hooks/useSignals.ts`
- `pages/SignalsPage.tsx`
- `components/settings/SignalFilterSettings.tsx`
Port the old app's approach (default set + reset behaviour + how it treats strategy-implied intervals
like OrderBlock's 1h) rather than reinventing. [[feedback-cherrypick-old-ui]]

## Decisions to confirm with Inge (she'll answer after compact)
- Should the interval filter DEFAULT + RESET to the scanned intervals (like strategies), or stay "All"?
- Should `1h` count as "scanning" because OrderBlock emits it (i.e. include strategy-implied intervals
  in the scanning set / the default)? Likely yes - mirror whatever the old app did.

## Likely fix shape (confirm against old app first)
- Compute the effective scanned-interval set = `enabledIntervals` PLUS intervals implied by enabled
  strategies (OrderBlock -> 1h), OR union with intervals actually present in signals. Use it for both
  the "scanning" dimming AND the default/reset set.
- Stop `App.tsx:110` from clobbering the user's live selection on every config-signature change (only
  apply newly-enabled options, or don't auto-reset intervals the user has touched).
- Files: bridge `settings-source.ts` (enabledIntervals), `App.tsx` (scannedFilters + line 110 + reset),
  maybe `FilterBar.tsx`.

## SOLUTION (ported from the old app - Inge: "we already solved this there")
The old app's `SignalsPage.tsx` proves the pattern:
- It keeps `filters` (user selection) SEPARATE from `defaultFilters` (scanned set) and, on a settings
  change, runs `reconcileWithScanner` to preserve the user's manual tweaks instead of clobbering.
- The scanned interval set = active scan intervals UNION each enabled ZONE strategy's own
  `IntervalList` (old app did this for FVG's `intervalPeriods`; comment: so those TFs are not dimmed
  "not scanning" and their signals are not filtered out).

Verified engine config (real settings JSON): scan `Interval=["1m","2m","3m"]`;
`ZonesSmc.IntervalList=["1h"]` (smc->OrderBlock), `ZonesFvg=["1d","1h","4h"]` (fvg->FairValueGap),
`ZonesDlz=["1h"]` (dlz->DominantLevel/Near). Zone->strategy map (shared STRATEGY_NAMES + aliases):
Smc -> OrderBlock(1004)/OrderBlockRejection(1006); Fvg -> FairValueGap(1003);
Dlz -> DominantLevel(1000)/DominantLevelNear(1001).

### Changes
1. **bridge `settings-source.ts` + shared `EngineSettings`**: add `scannedIntervals: string[]` =
   `enabledIntervals` UNION (each zone's `IntervalList` when any of its strategies is enabled). Read
   `Signal.ZonesSmc/ZonesFvg/ZonesDlz.IntervalList`; add those lists to `configSignature` so a zone
   change re-defaults too.
2. **`App.tsx`**: `scannedFilters()` intervals `[]` -> `settings.scannedIntervals` (default + Reset now
   tick 1m/2m/3m/1h). Add a `prevScanned` ref + a string-based `reconcileFilters(current, prev, next)`
   (ported from old `reconcileWithScanner`, strategies+intervals dims; leave side). Replace the
   clobbering `setFilters(scannedFilters(ev.settings))` at line ~110 with the reconcile. Seed
   `prevScanned` where filters are first defaulted (didInitFilters effect).
3. **`FilterBar.tsx`**: base `inactiveIntervals` dimming on `settings.scannedIntervals` (not
   `enabledIntervals`), so `1h` is no longer dimmed "not scanning".

### Decisions - RESOLVED per the old app (Inge said mirror it)
- Default + Reset -> the scanned set (concrete chips), NOT "All". YES.
- `1h` counts as scanning because OrderBlock emits it (union zone intervals). YES.

## Status
CODE DONE - awaiting Inge's manual test, then commit/PR (v0.8.15). PR #31 (CloseDate) merged (v0.8.14).

## Review (2026-07-30)
Ported the old app's filter/reset logic. Changes:
- `shared/src/index.ts`: added `EngineSettings.scannedIntervals`.
- `bridge/settings-source.ts`: computes `scannedIntervals` = `enabledIntervals` UNION each enabled zone
  strategy's `IntervalList` (ZONE_STRATEGIES map: Smc->OrderBlock/Rejection, Fvg->FairValueGap,
  Dlz->DominantLevel/Near). Zone lists also added to `configSignature`.
- `web/App.tsx`: `scannedFilters` intervals now = `scannedIntervals`; added `reconcileFilters` +
  `prevScanned` ref; the WS settings handler reconciles forward instead of clobbering; `prevScanned`
  seeded in the didInitFilters effect.
- `web/FilterBar.tsx`: interval dimming keyed on `scannedIntervals` (1h no longer dimmed).

Runtime proof: live bridge `/api/settings` returns `scannedIntervals: ["1m","2m","3m","1h"]` (OrderBlock
enabled). Typecheck + web build green.

### Manual test checklist for Inge
- Interval filter shows `1m 2m 3m 1h` ticked on load (not "All"); `1h` not greyed.
- Pick `1m` only -> stays picked (doesn't snap back to All) even as the engine keeps scanning.
- Reset -> returns to `1m 2m 3m 1h`.
- Toggling a strategy/interval in the scanner keeps your manual filter tweaks (reconcile).
