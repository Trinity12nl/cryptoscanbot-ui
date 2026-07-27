import * as ccxt from 'ccxt'
import type { PriceMap } from '@csb/shared'

/**
 * Live last-price feed for the "Change" column. The C# engine's Change is live price vs signal
 * price, and the oracle SQLite does NOT store live prices - so in Phase A we pull them ourselves
 * from the exchange's PUBLIC ticker feed (orthogonal to the scanning engine). In Phase B this can
 * be swapped for prices coming from the headless C# host; the PriceMap shape stays the same.
 *
 * Keyed by normalised symbol ("ONDO/USDT" -> "ONDOUSDT") so it matches Signal.symbol directly.
 */

// Oracle exchange name (Database.cs seed) -> ccxt id + market type (defaultType). Keyed by the exact
// names the engine writes ("Okx Futures", not "OKX Futures"), mirroring the chart-links table so any
// exchange the oracle reports gets a live-price feed. `type` is the ccxt defaultType: 'spot', 'swap'
// for linear perps, or 'future' for Binance USDT-M (which ccxt keys differently from other venues).
const EXCHANGE_MAP: Record<string, { id: string; type: 'spot' | 'swap' | 'future' }> = {
  'Binance Spot': { id: 'binance', type: 'spot' },
  'Binance Futures': { id: 'binance', type: 'future' },
  'Bitvavo Spot': { id: 'bitvavo', type: 'spot' },
  'BloFin Futures': { id: 'blofin', type: 'swap' },
  'Bybit Spot': { id: 'bybit', type: 'spot' },
  'Bybit Futures': { id: 'bybit', type: 'swap' },
  'Bybit EU Spot': { id: 'bybit', type: 'spot' },
  'Bybit EU Futures': { id: 'bybit', type: 'swap' },
  'Coinbase Spot': { id: 'coinbase', type: 'spot' },
  // HyperLiquid is intentionally omitted: it's a DEX (not a MiCAR-licensed CASP, out of scope) and
  // its public API rate-limits aggressively (429s on every poll). The Change column stays empty for
  // it. (chart-links.ts still maps it - building a TradingView URL makes no API call.)
  'Kraken Spot': { id: 'kraken', type: 'spot' },
  'Kraken Futures': { id: 'krakenfutures', type: 'swap' },
  'Kucoin Spot': { id: 'kucoin', type: 'spot' },
  'Kucoin Futures': { id: 'kucoinfutures', type: 'swap' },
  'Mexc Spot': { id: 'mexc', type: 'spot' },
  'Okx Spot': { id: 'okx', type: 'spot' },
  'Okx Futures': { id: 'okx', type: 'swap' },
}

function normSymbol(ccxtSymbol: string): string {
  return (ccxtSymbol.split(':')[0] ?? ccxtSymbol).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

export class TickerSource {
  private ex: ccxt.Exchange | null = null
  private prices: PriceMap = {}
  private timer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(p: PriceMap) => void>()
  private exchangeName: string | null = null
  // false while the engine's SignalR hub is feeding prices: the public ccxt ticker stands down to
  // avoid double-feeding the PriceMap (and the needless API load). Re-enabled when the hub drops.
  private enabled = true

  /** (Re)point at the exchange the engine reports. No-op if unchanged or unsupported. */
  start(exchangeName: string | null): void {
    if (exchangeName == null || exchangeName === this.exchangeName) return
    const cfg = EXCHANGE_MAP[exchangeName]
    if (!cfg) {
      // eslint-disable-next-line no-console
      console.warn(`[ticker] no ccxt mapping for "${exchangeName}" - Change column stays empty`)
      return
    }
    this.exchangeName = exchangeName
    const ExchangeClass = (ccxt as unknown as Record<string, new (c: object) => ccxt.Exchange>)[cfg.id]!
    this.ex = new ExchangeClass({ options: { defaultType: cfg.type }, enableRateLimit: true })
    // eslint-disable-next-line no-console
    console.log(`[ticker] feeding live prices from ${cfg.id} (${cfg.type})`)
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 4000)
    void this.poll()
  }

  /** Enable/disable the public ticker feed. When SignalR prices go live the bridge disables it (the
   * hub is authoritative); when the hub drops it re-enables and immediately polls again. Idempotent. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    // eslint-disable-next-line no-console
    console.log(`[ticker] ${enabled ? 'enabled (hub prices unavailable)' : 'disabled (SignalR prices live)'}`)
    if (enabled) void this.poll()
  }

  private async poll(): Promise<void> {
    if (!this.ex || !this.enabled) return
    try {
      const tickers = await this.ex.fetchTickers()
      const next: PriceMap = {}
      for (const t of Object.values(tickers)) {
        const price = t.last ?? t.close
        if (price != null && t.symbol) next[normSymbol(t.symbol)] = price
      }
      this.prices = next
      for (const cb of this.listeners) cb(next)
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[ticker] poll failed: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  getPrices(): PriceMap {
    return this.prices
  }

  subscribe(cb: (p: PriceMap) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.listeners.clear()
  }
}
