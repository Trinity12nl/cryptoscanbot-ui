# Barometer values RPC - bridge/web consumption (point 3)

## Doel
De web-UI laat elke gebruiker zijn eigen barometer-quote kiezen. De engine pusht echter maar
één quote (de `SelectedQuote` van de Avalonia-desktop). We hebben net de engine-RPC
`GetBarometerValues(quote)` gebouwd (avalonia PR #14). Nu de bridge/web-kant: roep die RPC aan
bij connect en bij quote-switch, zodat de 1h/4h/1d-waardes voor een zelfgekozen quote direct
verschijnen i.p.v. te wachten op (of nooit te krijgen van) de desktop-push.

## Huidige situatie (waarom dit nodig is)
- Barometer-*waardes* (tip: 1h/4h/1d) komen via WS-push `{type:'barometer'}` + snapshot
  `getBarometers()`. Alleen voor de quote die de desktop pusht.
- `MarketHeader.tsx`: de dropdown-opties = keys van de gepushte `barometers`-map → meestal maar
  één quote (USDT). De gebruiker kan dus feitelijk niet naar een andere quote switchen.
- De barometer-*graph* werkt al voor elke quote (`GetBarometerGraph(quote, interval)` RPC via
  `/api/barometer-graph`). Alleen de waardes-tip ontbrak voor een niet-gepushte quote.

## Aanpak (minimaal, per laag)

### Bridge
- [x] `signalr-dto.ts`: `parseBarometerValues` + `BarometerValuesWire` geëxporteerd zodat de RPC ze
      hergebruikt. RPC levert geen `LatestBarometerPoint`, dus `latest = null` → `calculatedAtMs`
      blijft null (waardes zijn wat telt; de web toont die tijd nergens).
- [x] `SignalrSource.getBarometerValues(quote)`: `invoke('GetBarometerValues', quote)` →
      `parseBarometerValues(wire, null)`. Rejecten als de hub niet verbonden is.
- [x] `HybridSource.getBarometerValues(quote)`: passthrough naar signalr.
- [x] `shared/index.ts`: optionele methode `getBarometerValues?(quote): Promise<Barometer>` op
      `ScannerDataSource`.
- [x] `server.ts`: HTTP-route `GET /api/barometer-values?quote=` (+ route-lijst in doc-comment).
      404 als de source hem niet heeft, 503 als de hub down is (zelfde patroon als barometer-graph).

### Web
- [x] `lib/api.ts`: `fetchBarometerValues(quote): Promise<Barometer | null>` (null bij 404/503).
- [x] `App.tsx`: `activeQuotes` (active quote coin-namen) doorgegeven aan `MarketHeader` als
      `quoteOptions`.
- [x] `MarketHeader.tsx`:
  - Dropdown-opties = unie van `quoteOptions` + gepushte keys, gesorteerd (fallback `['USDT']`).
  - Tip-resolutie: `pushedTip = barometers.get(activeQuote)`; ontbreekt die (niet-gepushte quote of
    connect vóór de eerste push), dan RPC + poll (~60s) → `rpcTip`. `tip = pushedTip ?? rpcTip`.
    Reset `rpcTip` bij elke quote-wissel zodat een oude reading nooit onder een nieuw label blijft.
  - `activeQuote` honoreert de keuze van de gebruiker, met USDT/first als fallback.

## Bewust NIET in scope
- Geen wijziging aan het push-pad of de desktop-app.
- Prices blijven op de ccxt-ticker (ongewijzigd).
- Geen nieuwe WS-event; de waardes-fetch is een on-demand HTTP-call per quote (zoals de graph).

## Test
- `pnpm -r typecheck` groen.
- Runtime met draaiende engine (SignalR aan): quote-dropdown toont alle actieve quotes; switch
  naar een niet-gepushte quote toont direct 1h/4h/1d + graph; `time` gevuld (dankzij de engine-fix).
- Manueel testen vóór commit.

## Review
- Bridge + web gebouwd; `pnpm -r typecheck` groen (shared/bridge/web/desktop).
- Runtime-geverifieerd tegen de draaiende engine via de al draaiende bridge-dev (tsx-watch herlaadde
  op de source-edit): `GET /api/barometer-values?quote=USDT` → `h1=-0.09 h4=0.05 d1=0.65` (echte
  waardes via de nieuwe RPC), `quote=BTC` → nette nullen + lege graph (quote zonder data, geen error).
  Beide HTTP 200. Bewijst de hele keten server → hybrid → signalr → hub-RPC.
- LET OP: in deze config is alleen USDT een actieve quote, dus de multi-quote-dropdown is niet
  visueel te testen zonder meer quote coins aan te zetten. De code-kant (unie-dropdown + RPC-fallback)
  is er wel; de bedrading is via de endpoint bewezen. De belangrijkste winst geldt ook bij één quote:
  op een verse page-load haalt de web de USDT-waardes nu meteen via RPC i.p.v. tot ~60s te wachten op
  de eerste push.
- De `calculatedAtMs` blijft null voor RPC-quotes (RPC heeft geen LatestBarometerPoint); onschadelijk
  want de web rendert die tijd nergens. De engine-`BarometerTime`-fix (PR #14) staat los hiervan.
- Probe kreeg er eerder al `pullValues` bij (hoort bij dit werk, mee te committen).

### Test-bevindingen (Inge, 2026-07-31) + fix
1. **Bekend/geaccepteerd:** een quote coin toevoegen laat de engine opnieuw syncen → `ApplicationStatus`
   valt even weg van `Running` → tips dragen `ready=false` → onze globale `engineLoading` toont weer
   laden+progress, en de waardes staan ~1 min op 0.00 tot de re-sync klaar is. De OG scanner gate't
   zijn barometer niet op die status, vandaar "instant". Eerlijk gedrag bij een zeldzame actie; niet
   gefixt (eventueel later de loading-gate per geselecteerde quote ontkoppelen).
2. **BUG gefixt:** de dropdown toonde ook gedeactiveerde quotes (BTC/USDC). Oorzaak: de dropdown was
   `unie(quoteOptions, barometers.keys())` en die barometer-map groeit alleen aan - ooit gepushte
   quotes bleven er in staan. Fix: dropdown = `quoteOptions` (active quote coins uit settings) alleen;
   alleen vóór settings geladen zijn terugvallen op gepushte keys / `['USDT']`. Web-only, hot-reload.
