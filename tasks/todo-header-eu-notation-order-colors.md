# Header polish: EU notation + scanner order + green/red prices

Three things Inge asked (2026-07-29), all in the scanner-header strip + number helpers.

## 1. European number notation (`.` thousands, `,` decimals)
- `packages/web/src/lib/format.ts`: switch the number helpers from `en-US`/`toFixed` (always `.`
  decimal) to Dutch locale `nl-NL` (`.` thousands, `,` decimals). Affects `formatPrice`, `formatNum`,
  `formatMacd`, `formatCompact`. Leave the date/clock helpers (`formatCandleRange`, `formatClock`,
  `en-CA`/`en-GB`) alone - those are dates, not decimals.
- `MarketHeader` Tickers count: `toLocaleString('en-US')` -> `'nl-NL'` so counters group as `69.009`.
- Applies everywhere the helpers are used (header + signals table): prices, %, counts, volumes.

## 2. Match the scanner header order
Scanner `DashBoardInformationView.axaml` layout (left->right): Status | Barometer | chart |
**Market Indicators | Crypto Prices | Tickers**. Our column order already matches (we use the header
status pill instead of the traffic-light Status block). The difference is *within* Market Indicators:
- Scanner order (TvSymbols[0..4]): **Market Cap Total, US Dollar Index, S&P 500, BTC Dominance,
  Fear and Greed index**. Our list arrives from the engine in an unstable order (seen reversed in the
  screenshot). Fix: sort our indicators into this fixed canonical order (keyword match, unknown -> end).
- Crypto Prices: scanner shows top-5 **by volume** (dynamic `TopSymbols`); ours is a fixed set
  (BTC/ETH/XRP/SOL/ADA). Keeping the fixed set for now (that's a set change, not an order change) -
  note for Inge if she wants dynamic top-by-volume too.

## 3. Green/red when prices / caps go up or down
- Market Indicators (incl. Market Cap Total) are already coloured by direction via `directionClass`
  (up=green, down=red vs the previous broadcast); Fear & Greed keeps its own 0-100 scale. So "caps"
  already works.
- Crypto Prices are NOT coloured (fixed zinc). Add direction colouring like the scanner's
  `TopSymbols[i].Color`: keep a ref of the previous price per symbol and colour each price green/red on
  up/down (unchanged/first-seen -> neutral). Volume stays neutral.

## Plan
- [ ] format.ts -> nl-NL for the 4 number helpers.
- [ ] MarketHeader: canonical indicator order + sort.
- [ ] MarketHeader: Tickers count nl-NL.
- [ ] MarketHeader: price direction colouring (prev-price ref).
- [ ] typecheck + build; Inge eyeballs; CHANGELOG (IMPROVED) + PR.

## Review (2026-07-29 - DONE, Inge approved visually, v0.8.13)
- **EU notation**: `format.ts` number helpers -> Dutch `nl-NL` (`.`/`,`). `formatCompact` = 2 decimals +
  suffix, no space ("656,50B", "7,43K"). New `formatCount` for grouped integers ("69.009"). Dates/times
  untouched.
- **Order**: Market Indicators sorted into the scanner's fixed order (Market Cap, USD Index, S&P 500,
  BTC Dominance, Fear & Greed) via keyword rank. Column order already matched.
- **Green/red**: replaced per-render `directionClass` (which reset to neutral on unchanged ticks) with a
  persistent `makeDirectionTracker` (ref) that flips only on an actual move and holds - matching the
  scanner's GetColorForChange. Applied to indicators AND prices. Fear & Greed is now directional too
  (was level-based) and stays a plain integer.
- **Symbols (evolved with Inge)**: first tried dynamic top-by-volume (her ask), but that surfaced
  USDC/HYPE; the scanner actually uses `ShowSymbolInformation`. Plumbed that through: bridge
  `settings-source.ts` + shared `EngineSettings.showSymbolInformation`, `App` passes it as `priceBases`,
  MarketHeader pairs each base with the active quote, skips non-existent pairs, takes the first
  `PRICE_COUNT` (5). Verified `/api/settings` returns `["BTC","PAXG","ETH","XRP","SOL","ADA"]`.
- typecheck + web build green. Shipped as PR (v0.8.13).
