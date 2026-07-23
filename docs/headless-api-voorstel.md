# Voorstel: headless modus voor CryptoScanBot (engine-API)

**Voor:** Marius
**Van:** Inge (Trinity)
**Doel:** de CryptoScanner-engine draaibaar maken zonder de Avalonia-UI, met een API erop, zodat
er ook andere front-ends (zoals mijn cross-platform UI) op dezelfde engine kunnen draaien -
inclusief het teruglezen én wegschrijven van instellingen.

---

## 1. Waar dit vandaan komt

Ik bouw een eigen UI (web + desktop via Electron, draait native op Mac/Windows/Linux). Die praat nu
al met de engine, maar in een tussenstap ("Fase A"): ik lees jouw SQLite-oracle en de settings-JSON
**alleen-lezen** uit, via een klein lokaal Node-bruggetje. Dat werkt, maar het is eenrichtingsverkeer
en mist de dingen die alleen in het geheugen van de engine leven (barometer, live market-trend).

De volgende stap ("Fase B") is een **headless engine met een API**. Mijn UI is daar al op voorbereid:
ze praat uitsluitend met een klein aantal endpoints. Als jouw headless host diezelfde endpoints
serveert, valt mijn UI er zonder aanpassingen op. Dit document is die concrete API-afspraak.

## 2. Architectuur: geen extra laag, maar een andere voorkant

Jouw applicatie is nu eigenlijk al twee dingen:

```
[ CryptoScanner.Core   ← de engine: scannen, indicatoren, settings laden/opslaan, DB ]
[ Avalonia-UI          ← één afnemer van die engine ]
```

`Core` is al UI-onafhankelijk. **Headless = de Avalonia-UI vervangen door een dunne API-host** die
diezelfde `Core` aanstuurt:

```
[ CryptoScanner.Core ]
[ Headless API-host (HTTP + WebSocket)   ← in plaats van de GUI ]
```

Het is dus geen herschrijving en geen extra laag bovenop alles - het is een tweede, kleinere voorkant
die dezelfde engine deelt. De GUI en de headless host kunnen naast elkaar blijven bestaan.

## 3. De API die mijn UI vandaag al spreekt (de basis-spec)

Dit zijn de endpoints en de datavormen die mijn UI nu al gebruikt. Als de headless host deze levert,
is het leeuwendeel klaar. (JSON-namen zijn een voorstel, we kunnen ze samen vastzetten.)

### Endpoints (lezen)

```
GET /api/info                     -> EngineInfo
GET /api/signals?limit=1000       -> Signal[]
GET /api/symbols?exchange=<naam>  -> SymbolRow[]
GET /api/settings                 -> EngineSettings
GET /api/prices                   -> { "<SYMBOOL>": <laatste prijs>, ... }
WS  /ws                           -> live events (zie onder)
```

### Datavormen

```jsonc
// EngineInfo
{ "exchange": "Bybit Spot", "connected": true, "lastChangeMs": 1737550000000 }

// Signal  (1 rij in de signalen-tabel)
{
  "id": 12345,
  "exchange": "Bybit Spot",
  "symbol": "ONDOUSDT",
  "interval": "5m",
  "strategyId": 6,
  "strategy": "Stobb",
  "side": "long",                 // "long" | "short"
  "price": 0.3982,
  "volume": 3250000,
  "trendPrimary": 62.5,           // Dow  (TrendPercentagePrimary)
  "trendSecondary": -10.0,        // BOS/CHoCH (TrendPercentageSecondary)
  "bbPercentage": 0.12,
  "change24h": -3.4,
  "effective": 1.8,               // LastXDaysEffective
  "rsi": 28.1, "stochOsc": 12.0, "stochSig": 15.0, "macdHistogram": -0.0004,
  "barcode": 0.2,
  "eventText": "",
  "openDateMs": 1737549900000     // open-tijd, epoch ms UTC
}

// SymbolRow
{ "exchange": "Bybit Spot", "name": "ONDOUSDT", "base": "ONDO", "quote": "USDT",
  "volume": 3250000, "status": 1 }

// EngineSettings  (nu alleen-lezen; in headless ook schrijfbaar - zie 4)
{
  "activeExchange": "Bybit Spot",
  "enabledStrategies": ["Sbm1","Sbm2","Sbm3","Stobb"],
  "enabledIntervals": ["1m","3m","5m"],
  "sides": { "long": true, "short": true },
  "quoteCoins": [ { "name": "USDT", "minVolume": 2000000, "active": true } ],
  "removeSignalAfterCandles": 0
}
```

### WebSocket-events

De WS-verbinding stuurt bij binnenkomst de huidige stand, en daarna push-updates:

```jsonc
{ "type": "info",     "info": { ... } }
{ "type": "signals",  "signals": [ ... ] }   // zodra er nieuwe signalen zijn
{ "type": "prices",   "prices": { ... } }    // live prijzen
{ "type": "settings", "settings": { ... } }  // als de instellingen wijzigen
```

### Transport: kale WebSocket of SignalR?

Marius stelde voor om **SignalR** te gebruiken voor de live push (bovenop de REST-endpoints). Dat
is prima - hieronder waarom, en wat het voor de koppeling betekent.

Functioneel maakt het voor de UI niet uit: mijn front-end praat alles via één abstractielaag
(`ScannerDataSource`), dus of daar een kale browser-`WebSocket` of een `@microsoft/signalr`-client
onder zit, is één module aan mijn kant. De keuze wordt dus bepaald door wat de **server** het
handigst maakt - en dat is Marius' kant.

**Waarom SignalR (voordeel zit aan de serverkant):**
- **.NET-ergonomie.** SignalR is Microsofts eigen realtime-stack: hubs, sterk getypeerde methodes,
  automatische (de)serialisatie. Veel minder boilerplate dan een rauwe WebSocket-server met de hand
  in ASP.NET Core. Dit is het echte voordeel, en het valt precies waar het werk zit.
- **Auto-reconnect + backoff** zit in de client ingebouwd (dat rollen we nu zelf).
- **Groups / connection management** maken later per-user kanalen triviaal (relevant zodra het
  multi-user wordt; nu nog niet).

**Wat het kost (klein, en aan mijn kant):**
- Een client-dependency (`@microsoft/signalr`) i.p.v. de native `WebSocket`, met een eigen
  handshake-protocol (frames met een `\x1e`-scheider). Iets minder makkelijk te debuggen dan "gewoon
  een WS", maar contained in één transport-module.
- De transport-fallback van SignalR (WS -> SSE -> long-polling) is voor ons loze winst: localhost in
  Chrome/Electron heeft altijd WebSockets.

**Conclusie:** SignalR, omdat de kosten (één adaptermodule) bij mij landen en het voordeel (minder
boilerplate) bij de engine-host. De event-vormen hierboven blijven het contract - ze reizen dan
alleen over een SignalR-hub in plaats van een kale WS.

**Eén ontwerpkeuze om samen te maken:** praat de SignalR-hub **direct met de browser**, of houden we
mijn Node-bruggetje ertussen als vertaler (SignalR-upstream -> mijn UI)? Direct is schoner; het
bruggetje-als-adapter is een terugvaloptie. Hoeft nu nog niet vast, maar het is het enige echte
koppelpunt.

## 4. Wat er nieuw bij komt voor "echt" headless

Bovenop wat ik nu al lees, zijn er drie net-nieuwe stukken die alleen de engine kan leveren:

1. **Instellingen wegschrijven** - het belangrijkste verschil met nu:
   ```
   PUT /api/settings    body: EngineSettings (of een deel ervan)  -> toegepast + opgeslagen
   ```
   De host neemt de nieuwe settings aan, past ze toe op `GlobalData.Settings`, roept jouw bestaande
   opslag-routine aan, én triggert de "toepassen"-logica (opnieuw intervallen abonneren, herstarten
   scan, opnieuw ophalen). Zie punt 5 - dit is het enige echt nieuwe werk.

2. **Live in-memory data die niet in SQLite staat** - vooral de **barometer** en de **live
   market-trend** per interval. Bijvoorbeeld:
   ```
   GET /api/barometer   -> per interval/quote de barometerwaarde(s)
   WS  { "type": "barometer", ... }   // live push
   ```
   Marius: de barometer staat in de db als candles onder `symbol=$BMPUSDT`, maar het meeste gebeurt
   in het geheugen en wordt pas ~1x per uur geflushed (om de achterstand bij een crash te beperken).
   Gevolg voor de UI: de **historie** lees ik gewoon uit die `$BMPUSDT`-candles, maar de **actuele**
   waarde moet via de push komen (de db loopt tot een uur achter). Dit is precies waarom deze data
   een live-endpoint/push nodig heeft en niet puur uit SQLite te halen is.

3. **Besturing (optioneel maar handig):**
   ```
   POST /api/control/start | /stop
   POST /api/exchange       body: { "exchange": "OKX Spot" }   // actieve beurs wisselen
   ```

## 5. Wat er op de C#-kant moet gebeuren

1. **Headless bootstrap** - een console/worker-host die `Core` opstart zoals de app dat bij het
   starten doet (settings laden, beurs verbinden, scan-loop starten), maar **zonder vensters**.
   `Core` compileert en draait al native op Mac, dus dit is vooral bekabeling.
2. **HTTP + WebSocket API** - bijv. ASP.NET Core minimal API. De lees-endpoints uit sectie 3 zijn
   dunne projecties over bestaande engine-data.
3. **Het enige echte werk: "settings toepassen" buiten de GUI.** Nu zit de logica van "gebruiker
   klikt Toepassen -> engine reageert" vaak in het instellingen-scherm van de GUI. Voor headless moet
   dat toepas-pad **aanroepbaar zijn buiten de UI** - dus naar `Core` (of een gedeelde service) zakken,
   zodat zowel de GUI als de API het aanroept. Zodra dat pad losstaat van de UI, is de rest vooral
   koppelwerk: de API-endpoints geven bestaande engine-data door, zonder nieuwe logica.
4. **Thread-veiligheid** - de engine draait achtergrond-loops terwijl de API tegelijk leest/schrijft.
   Gedeelde toegang moet veilig zijn (locks / immutable snapshots).

**Inschatting (eerlijk):** begrensd, geen maandenwerk. Voor wie de codebase kent (jij) eerder dagen
dan weken. De grootste onbekenden zijn punt 3 (de toepas-refactor) en punt 4 (threading).

## 6. Het voorstel

Ik denk dat het het slimst is als **jij** de headless modus in je eigen solution bouwt (bijv. een
`--headless` vlag of een apart host-project), en ik lever de API-afspraak + mijn UI die er direct op
past. Redenen:

- Jij bent eigenaar van de engine en van de toepas-logica - jij kunt punt 5.3 goed en snel doen.
- Eén codebase, één bron van waarheid. Als ik een losse host zou bouwen die jouw `Core` als library
  gebruikt, breekt elke refactor van jou mijn kant, en dupliceren we de toepas-logica.
- Het lost de licentievraag op: het blijft in jouw repo.
- De API-afspraak is er al - dit document is de spec, afgeleid van wat mijn UI vandaag al spreekt.

**Concreet aanbod:** ik kan meebouwen/meedenken aan de API-laag en het contract samen met jou
vastzetten, en ik test doorlopend met mijn UI erop. Als jij de engine-kant (bootstrap + toepas-pad)
voor je rekening neemt, hebben we samen een werkende headless CryptoScanBot met een moderne,
cross-platform voorkant.

---

*Bijlage: de volledige, actuele datavormen staan in `packages/shared/src/index.ts` van mijn repo -
dat is de levende versie van dit contract.*
