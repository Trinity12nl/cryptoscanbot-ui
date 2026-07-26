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

## Hub methods / events

Mirror `ReceiveSignal`:

```csharp
// SignalRService (broadcast side) - called from wherever the barometer/prices refresh:
await _hubContext.Clients.All.SendAsync("ReceiveBarometer", barometerDto);   // per quote
await _hubContext.Clients.All.SendAsync("ReceivePrices", priceSnapshotDto);  // batched

// CryptoSignalHub.OnConnectedAsync - snapshot the current state to just this caller:
await Clients.Caller.SendAsync("ReceiveBarometer", currentBarometerDto);
await Clients.Caller.SendAsync("ReceivePrices", currentPriceSnapshotDto);
```

Barometer broadcast fires when `CryptoBarometerData` is recalculated (per interval close). Prices
fire on a throttled timer / ticker update.

## Bridge side (our repo, when we wire it up)

- `packages/bridge/src/signalr-source.ts`: add handlers for `ReceiveBarometer` / `ReceivePrices`,
  translate PascalCase -> our camelCase, emit existing `{ type: 'prices' }` (and a new
  `{ type: 'barometer' }`) `BridgeEvent`s.
- When SignalR prices are live, stop the public ccxt `ticker-source` (avoid double-feeding PriceMap).
- New `BridgeEvent`: `{ type: 'barometer'; barometer: ... }` in `packages/shared/src/index.ts`.

## Open questions for Marius

- OK to add `BarometerSnapshotDto` / `PriceSnapshotDto` + the two `SendAsync` events + the
  `OnConnectedAsync` snapshot? (All additive, gated by the existing `SignalREnabled`.)
- Prices: compact map (A) fine, or does he want per-symbol 24h-change now (B)?
- Throttle interval for prices he's comfortable with (1-2 s?).

## Review

(to fill in once building)
