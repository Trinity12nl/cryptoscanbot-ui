# SignalR barometer + prices broadcast - DTO design (for the Marius PR)

> Status: **DESIGN ONLY.** Building the PR on the avalonia branch is on hold until Marius
> says yes to the offer. This file is the proposal we hand him / build from.

## Goal (issue #3)

Today the UI gets live **signals** over SignalR (`ReceiveSignal` + `CryptoSignalDto`), but the
**barometer** and **live prices** are engine-in-memory only (not in SQLite). So the UI fakes prices
from a public ccxt ticker (`packages/bridge/src/ticker-source.ts`) and has no live market barometer.

We want the C# scanner to also push, over the same hub:

1. `ReceiveBarometer` - the current price-barometer per quote/interval.
2. `ReceivePrices` - the current last-price per symbol (replaces the public ticker).
3. **Snapshot-on-connect** - on `OnConnectedAsync`, send the current barometer + prices to the new
   client so the UI is populated instantly instead of blank until the next tick.

Everything mirrors the existing `CryptoSignalDto` conventions: a plain PascalCase DTO with a
`FromXxx` factory, JSON `PropertyNamingPolicy = null` (PascalCase on the wire).

## How it maps onto the UI (so the shapes are right)

- UI `PriceMap = Record<string, number>` = `symbolName -> lastPrice` (e.g. `"BTCUSDT" -> 42123.5`).
  A prices broadcast is just this map for the active exchange.
- UI thinks of barometers as per-interval buckets `Barometer15m/30m/1h/4h/1d` (same fields the signal
  already carries). A barometer broadcast is those buckets per quote coin (USDT, BTC, ...).

## DTO 1 - Barometer

One message carries every interval for one quote, so the UI gets a full row at once. `Value` is the
price-barometer percentage (`CryptoBarometerData.PriceBarometer`). Volume barometer is experimental
in the engine - leave it out for now (add later if it matters).

```csharp
namespace CryptoScanner.Core.SignalR;

/// <summary>
/// Lightweight DTO broadcasting the live price-barometer for one exchange/quote,
/// across the standard intervals. Mirrors the Barometer15m..1d fields on CryptoSignalDto.
/// </summary>
public class BarometerDto
{
    public string Exchange { get; set; } = "";
    public string Quote { get; set; } = "";   // USDT, BTC, ...

    // Price-barometer percentage per interval (null = not calculated yet).
    public float? Barometer15m { get; set; }
    public float? Barometer30m { get; set; }
    public float? Barometer1h { get; set; }
    public float? Barometer4h { get; set; }
    public float? Barometer1d { get; set; }

    /// <summary>When these values were last (re)calculated, UTC.</summary>
    public DateTime CalculatedAt { get; set; }

    public static BarometerDto FromQuote(CryptoExchange exchange, CryptoQuoteData quoteData)
    {
        // Helper: read PriceBarometer for one interval from quoteData.BarometerDataList,
        // cast decimal? -> float? to match CryptoSignalDto's barometer fields.
        static float? Read(CryptoQuoteData q, CryptoIntervalPeriod period)
            => q.BarometerDataList.TryGetValue(period, out var d) ? (float?)d.PriceBarometer : null;

        return new BarometerDto
        {
            Exchange = exchange.Name,
            Quote = quoteData.Name,
            Barometer15m = Read(quoteData, CryptoIntervalPeriod.interval15m),
            Barometer30m = Read(quoteData, CryptoIntervalPeriod.interval30m),
            Barometer1h  = Read(quoteData, CryptoIntervalPeriod.interval1h),
            Barometer4h  = Read(quoteData, CryptoIntervalPeriod.interval4h),
            Barometer1d  = Read(quoteData, CryptoIntervalPeriod.interval1d),
            CalculatedAt = DateTime.UtcNow,
        };
    }
}
```

Broadcast one `BarometerDto` per quote coin (there are only a few). Optional convenience wrapper if
he'd rather send a single message:

```csharp
public class BarometerSnapshotDto
{
    public string Exchange { get; set; } = "";
    public DateTime Date { get; set; }
    public List<BarometerDto> Quotes { get; set; } = [];
}
```

## DTO 2 - Prices

600+ symbols, so **never one message per symbol**. Send a batch snapshot, throttled (e.g. every
1-2 s, or only changed symbols). Two flavours - pick one:

**A. Compact map (matches the UI's PriceMap directly, smallest payload):**

```csharp
public class PriceSnapshotDto
{
    public string Exchange { get; set; } = "";
    public DateTime Date { get; set; }
    /// <summary>symbolName -> last price. Maps 1:1 to the UI's PriceMap.</summary>
    public Dictionary<string, decimal> Prices { get; set; } = [];
}
```

**B. Per-symbol DTO (room for 24h change etc., slightly larger):**

```csharp
public class PriceDto
{
    public string Symbol { get; set; } = "";      // BTCUSDT
    public decimal Price { get; set; }
    public float? Change24h { get; set; }          // optional, = Last24HoursChange
}

public class PriceSnapshotDto
{
    public string Exchange { get; set; } = "";
    public DateTime Date { get; set; }
    public List<PriceDto> Prices { get; set; } = [];
}
```

Recommendation: **A** - it's exactly the UI's `PriceMap`, minimal bytes, and 24h-change already
rides along on each signal. Go to **B** only if we later want live 24h-change independent of signals.

## Barometer graph: pull the history, push the tip (AGREED with Marius)

Inge wants the **whole** barometer graph shown, not just the latest values. The graph is a **7-hour
window** (`Constants.BarometerGraphHours = 7`) held as candles on the synthetic barometer symbol
(`IsBarometerSymbol`), per quote + interval. Sending that whole history on every push would be wasteful
(5 interval series x ~7h). Marius' model (adopted):

1. **Pull the initial/full graph via a request/response hub endpoint.** The UI invokes it on connect
   and whenever the user switches timeframe (1h / 4h / 1d), and gets the entire series back:

   ```csharp
   // Hub method (client invokes, server returns) - reads the barometer-symbol candle series:
   public async Task<BarometerGraphDto> GetBarometerGraph(string quote, string interval) { ... }

   public class BarometerPointDto { public DateTime Date { get; set; } public float Value { get; set; } }
   public class BarometerGraphDto
   {
       public string Exchange { get; set; } = "";
       public string Quote { get; set; } = "";
       public string Interval { get; set; } = "";
       public List<BarometerPointDto> Points { get; set; } = [];   // ~7h of points
   }
   ```

2. **Push only the tip, once a minute.** The per-minute broadcast carries the latest value(s); the UI
   appends the new point and drops the oldest (7h sliding window). The `BarometerDto` above
   (Barometer15m..1d + `CalculatedAt`) is exactly this tip - one message updates every interval's series.

   ```csharp
   await _hubContext.Clients.All.SendAsync("ReceiveBarometer", tipDto);   // latest value(s), 1/min
   await _hubContext.Clients.All.SendAsync("ReceivePrices", priceSnapshotDto);  // latest symbol prices
   ```

## Loading state: pulsate until ready, never a half-filled graph (AGREED with Inge)

While the scanner is still building the barometer on startup (the `5 / 96 (AAVEUSDT)` pass in the
C# app), Inge wants the Light interface to show **pulsating red/green skeleton candles** - NOT a
partially-filled graph. The real barometer graph only appears once loading is fully done.

So the graph pull must tell the UI **whether the barometer is ready or still loading**, otherwise it
can't know when to stop pulsating. There's a clean global flag for exactly this:

- **`GlobalData.ApplicationStatus`** (`CryptoApplicationStatus.Initializing` -> `Running`). It flips
  to `Running` only at the end of the startup load (`ThreadLoadData.cs`, right after the `"... ready"`
  log). "All loading done" == `ApplicationStatus == Running`. On a scanner restart it drops back to
  `Initializing`, so the flag self-heals the loading state across restarts too.

Add a `Ready` flag to `BarometerGraphDto` driven by that global, plus a `Progress` string so the UI
can show the live "5 / 96 (AAVEUSDT)" label under the pulsating skeleton. Both map to existing engine
state - no new counters to maintain:

- **`Ready`** <- `GlobalData.ApplicationStatus == CryptoApplicationStatus.Running`.
- **`Progress`** <- `GlobalData.CandleProgressText`. The engine already sets this in the candle-fetch
  loop (`CandleBase.cs:120`, `$"{done} / {symbolTotal}  ({symbol.Name})"`) and clears it to `""` when
  the fetch finishes (`CandleBase.cs:138`). So it's the exact string the C# app shows on screen.

The per-minute tip can carry both too, so the UI flips from skeleton to live graph (and updates the
progress label) the moment the scanner reports ready.

```csharp
public class BarometerGraphDto
{
    public string Exchange { get; set; } = "";
    public string Quote { get; set; } = "";
    public string Interval { get; set; } = "";
    public bool Ready { get; set; }                       // false while ApplicationStatus == Initializing
    public string Progress { get; set; } = "";            // GlobalData.CandleProgressText, e.g. "5 / 96 (AAVEUSDT)" ("" when done)
    public List<BarometerPointDto> Points { get; set; } = [];
}
```

UI rule: `Ready == false` (or no points yet) -> show pulsating skeleton candles, with the `Progress`
string as a "loading… 5 / 96 (AAVEUSDT)" label beneath them; `Ready == true` -> render the real
series. Never draw the partial series.

## Scanner restart robustness (Marius' concern - solved by the pull)

His worry: a one-time snapshot-on-connect could hand a reconnecting client **stale/empty** data,
because right after a restart the scanner has `Clear()`'d its in-memory barometer and hasn't re-synced
candles yet. The **pull endpoint removes that risk**: the client doesn't depend on a pushed snapshot -
on (re)connect it *pulls* `GetBarometerGraph` and re-pulls prices, so it always fetches whatever is
valid *now*. Belt-and-suspenders:

- Bridge uses SignalR **automatic reconnect**; on `onreconnected` it re-invokes `GetBarometerGraph`
  (per active interval) + refreshes prices. A scanner restart forcibly drops the connection, so this
  fires naturally.
- The tip DTO fields are nullable (`float?`); the UI shows null as **"waiting for the scanner"**, never
  a fake `0`. The per-minute pushes then self-heal the graph as the scanner recomputes.
- No special server-side restart code needed beyond the endpoint returning the current series.

## Prices

Same as before - compact `PriceSnapshotDto` map (option A) pushed as the latest symbol prices; replaces
the public ccxt `ticker-source`.

## Market Indicators ("TV values / F&G") - resolved

Inge's screenshot pinned down what Marius meant: it's the scanner header's **Market Indicators** panel -
5 slow-moving macro values, TradingView-sourced (`TradingViewSymbolInfo` / `TradingViewService`) plus
Fear & Greed from alternative.me:

| Name             | TV symbol           | GlobalData field                  |
|------------------|---------------------|-----------------------------------|
| Market Cap Total | `CRYPTOCAP:TOTAL3`  | `TradingViewMarketCapTotal`       |
| US Dollar Index  | `TVC:DXY`           | `TradingViewDollarIndex`          |
| S&P 500          | `SP:SPX`            | `TradingViewSpx500`               |
| BTC Dominance    | `CRYPTOCAP:BTC.D`   | `TradingViewBitcoinDominance`     |
| Fear & Greed     | alternative.me      | `FearAndGreedIndex`               |

In the app they're `DashboardSymbolViewModel { Symbol, Name, Price (decimal), Volume (double) }` (F&G
sets only Price). A faithful DTO:

```csharp
public class MarketIndicatorDto
{
    public string Name { get; set; } = "";   // "US Dollar Index", "Fear and Greed index", ...
    public decimal Value { get; set; }        // Price
    public double Volume { get; set; }        // Volume where relevant (0 for F&G)
}
public class MarketIndicatorsDto
{
    public DateTime Date { get; set; }
    public List<MarketIndicatorDto> Indicators { get; set; } = [];
}
```

Broadcast `ReceiveMarketIndicators` on the same ~1/min tick (they barely move), and include in the
connect/pull snapshot. These are display-only.

**Architecture note for Marius:** the SignalR hub/service is in `CryptoScanner.Core`, but
`TradingViewService` (and these values) live in the **app** project (`CryptoScanner/Services`). So the
broadcast needs either the values surfaced into Core (e.g. `GlobalData`) or the app layer pushing them
into the hub. His call - he owns that boundary.

## The bigger picture: this is the scanner header

The screenshot shows the C# scanner header, which is what the "Light interface" mirrors. Panel -> our plan:

- **Barometer** (quote + interval selector, graph, latest values) -> barometer graph (pull + tip).
- **Crypto Prices** (BTC/ETH/XRP/SOL/PAXG, price + volume) -> the prices map (a curated subset of it).
- **Market Indicators** (Cap/DXY/S&P/Dominance/F&G) -> `MarketIndicatorsDto` above.
- **Status** (Scanner/Trader/Rulez + timer) -> we already have engine liveness; Trader/Rulez are trading.
- **Tickers** (Kline/analyze/signal counts, Open positions) -> counters are nice-to-have; **Open
  positions = trading, out of scope** for the Light interface.

## Out of scope for now: positions / trading (Light interface)

Marius asked about fetching **positions** (trader / paper-trading). Agreed with Inge + Marius: **not
now** - a "Light interface" (signals, symbols, barometer, prices) first. This matches our project scope
(trading is backlog). Revisit as a later phase if we replace the full interface.

## Bridge side (our repo, when we wire it up)

- `packages/bridge/src/signalr-source.ts`: add handlers for `ReceiveBarometer` / `ReceivePrices`
  (tip + prices), and an `invoke('GetBarometerGraph', quote, interval)` call on connect / reconnect /
  timeframe-switch. Translate PascalCase -> our camelCase, emit `{ type: 'prices' }` and new
  `{ type: 'barometer' }` / `{ type: 'barometerGraph' }` `BridgeEvent`s.
- When SignalR prices are live, stop the public ccxt `ticker-source` (avoid double-feeding PriceMap).
- New `BridgeEvent`s in `packages/shared/src/index.ts` for the barometer tip + graph.

## Open questions for Marius

- Endpoint signature OK: `GetBarometerGraph(quote, interval) -> BarometerGraphDto`? Per-interval on
  demand (lazy), or return all intervals at once?
- Prices: compact map (A) fine, or per-symbol 24h-change now (B)?
- Market indicators: how does he want to bridge them from the app-layer `TradingViewService` to the
  Core hub (surface into `GlobalData`, or push from the app layer)?
- Push cadence: barometer tip + indicators every minute (his suggestion); prices same minute tick, or
  faster for a snappier Change column?

## Review

### Progress (branch `feat/signalr-barometer-prices` in CryptoScanBot-avalonia, local-only)

Synced `avalonia` to `50c5e337` (33 new commits from Marius, none in the SignalR area) and cut the
feature branch. Built the barometer + prices parts; **`dotnet build CryptoScanner.Core` = 0 errors**
(compile-verify only, scanner not run).

**Done (all in `CryptoScanner.Core/SignalR/`, additive, gated behind the existing SignalR server which
only starts when `SignalREnabled`):**

- `BarometerDto.cs` - per-quote tip DTO (Barometer15m..1d from `quoteData.BarometerDataList[period].PriceBarometer`,
  `CalculatedAt`, `Ready` <- `ApplicationStatus == Running`, `Progress` <- `GlobalData.CandleProgressText`).
  Factory `FromQuote(exchange, quoteData)`.
- `BarometerGraphDto.cs` - `BarometerPointDto {Date, Value}` + `BarometerGraphDto {Exchange, Quote,
  Interval, Ready, Progress, Points}`. Static `Build(quote, interval)` reads the synthetic `"$BMP"+quote`
  symbol's candle series for that interval, walking back `BarometerGraphHours*60` (420) one-minute points
  from the last candle, using `candle.Close` and skipping malfunction spikes outside (-50,50) - mirrors
  `DashBoardInformationViewModel.CreateBarometerBitmap`. Points returned oldest-first.
- `PriceSnapshotDto.cs` - compact `Dictionary<string,decimal> Prices` (option A). `FromExchange(exchange)`
  reads `symbol.LastPrice`, skips inactive/barometer/null-price symbols.
- `CryptoSignalHub.cs` - added `GetBarometerGraph(quote, interval)` pull endpoint + snapshot-on-connect
  (`OnConnectedAsync` sends current prices + per-quote barometer tips to the new client).
- `SignalRService.cs` - added `BroadcastBarometer()` (per-quote tips) + `BroadcastPrices()`, mirroring
  `BroadcastSignal`.

Note: `CryptoExchange` collides with a namespace; qualify as `Model.CryptoExchange` (as `GlobalData`
does). Mac build gotcha: kill stale `VBCSCompiler` procs and pass `-p:UseSharedCompilation=false` or the
obj DLL write is "Access denied".

### Session 2 - broadcast wiring + market indicators (DONE, both projects build 0 errors)

- **Per-minute broadcast wired.** The barometer recalc is driven by the app layer, not Core:
  `DashBoardInformationViewModel.OnBarometerTimer` (a 2s DispatcherTimer that does the real work once a
  minute via the `Second>10 && Minute!=BarometerLastMinute` guard). Hooked in there:
  - Per-minute block (after `CalculateBarometer()` succeeds): `GlobalData.SignalRService?.BroadcastBarometer()`
    + `BroadcastMarketIndicatorsToSignalR()`.
  - Throttled ~4s prices push (`_lastPricesBroadcastUtc`): `GlobalData.SignalRService?.BroadcastPrices()`
    - faster than the barometer so the Change column stays snappy (matches the ~4s ccxt cadence it replaces).
  - All no-ops when SignalR is disabled (guards live inside SignalRService).
- **Market Indicators** (`MarketIndicatorsDto.cs` in Core/SignalR): `MarketIndicatorDto {Name, Value,
  Volume}` + `MarketIndicatorsDto {Date, Indicators}`. Plain DTO, no TradingView dep in Core.
  - `SignalRService.BroadcastMarketIndicators(dto)` broadcasts on `ReceiveMarketIndicators` and caches
    `LastMarketIndicators` (for snapshot-on-connect, since the values live in the app layer).
  - **APP -> CORE BOUNDARY** (clearly marked in both files): app-layer
    `DashBoardInformationViewModel.BroadcastMarketIndicatorsToSignalR()` maps the 5 `TvSymbols`
    (4 TradingView + Fear&Greed, from `_tradingViewService.TvSymbols`; `Value=Price??0`, `Volume=Volume??0`)
    onto the plain DTO and pushes it in. If we later surface values via `GlobalData` instead, only this
    method + `BroadcastMarketIndicators` change.
  - Hub `SendSnapshotAsync` now also replays `LastMarketIndicators` to a newly connected client.

**Build:** `dotnet build CryptoScanner.Core` and `dotnet build CryptoScanner` both = **0 errors**
(compile-verify only; scanner never run). The old app-project Mac workarounds were already fixed upstream.

### Session 3 - live-tested against the running scanner (2 bugs found + fixed)

Tested end-to-end with the standalone probe (`packages/bridge/probe-signalr.mjs`, `pnpm --filter
@csb/bridge probe:signalr`) against a scanner built from this branch. Barometer graph pull (420 pts),
per-minute tip, market indicators (all 5 incl. F&G), snapshot-on-connect and the loading state
(`Ready=false` + `Progress="25 / 25 (XRPUSDT)"` -> `Ready=true`) all confirmed live. Two real bugs the
compile could never have caught:

1. **Barometer tip read the wrong store.** `BarometerDto.FromQuote` read `quoteData.BarometerDataList`
   from the `GlobalData.Settings.QuoteCoins` object, which is NEVER populated by the calc. Fixed to read
   `exchange.Data.GetBarometer(quote, period)` (the runtime store the graph + app display use). Tips went
   from all-null to real values matching the graph's last point.
2. **Prices covered too few symbols.** First used `symbol.LastPrice` only (set solely by live ticker
   streams -> sparse, ~11-40). Fixed to fall back to the most recent candle close, trying intervals
   finest-first (1m exists only for streamed symbols; 15m+ are loaded for the whole fetched set). Now
   every loaded symbol gets a price and there's no blank Change right after launch.

Investigation conclusion (via a temporary diagnostic, since removed): the price count == the actually
**fetched/loaded** symbol set (~40 on Bybit Spot), which is decided at **startup** from the volume
filter. Lowering min-volume live only re-counts `EnoughVolume()` (a live count); it does NOT fetch the
newly-qualifying symbols' candles until a restart. So the count not growing with the slider is correct
engine behaviour, not a bug - and the loaded set is exactly the symbols that can raise signals, so the
UI's Change column is fully covered. (Bybit Spot has 418 USDT symbols total, unfiltered; only the
volume-passing, fetched subset carries candles/prices.)

Iterated via self-contained publishes `publish-signalr-fix` .. `-fix4` (gitignored bin artifacts;
clean up later). Final clean build has the diagnostic stripped.

**Still TODO (next session - the cryptoscanbot-ui / bridge + web side, separate repo):**

- Bridge (`packages/bridge/src/signalr-source.ts`): handlers for `ReceiveBarometer` / `ReceivePrices` /
  `ReceiveMarketIndicators`, and `invoke('GetBarometerGraph', quote, interval)` on connect / reconnect /
  timeframe-switch. Translate PascalCase -> camelCase; new `BridgeEvent`s in `packages/shared`.
- Web: render the barometer graph (pulsating skeleton while `!Ready`, with the `Progress` label), the
  crypto-prices subset, and the Market Indicators panel. Stop the public ccxt `ticker-source` once
  SignalR prices are live (avoid double-feeding PriceMap).

Local-only: nothing pushed, no PR, uncommitted for Inge's review. Awaiting Marius's answers on the open
questions (endpoint shape / prices A-B / cadence) before finalizing, but the C# side is complete + builds.
