import * as ccxt from 'ccxt'
import type { PriceMap } from '@csb/shared'

/**
 * Live last-price feed for the "Change" column. The C# engine's Change is live price vs signal
 * price, and the oracle SQLite does NOT store live prices - so in Phase B we pull them ourselves
 * from the exchange's PUBLIC ticker feed (orthogonal to the scanning engine). In Phase A this can
 * be swapped for prices coming from the headless C# host; the PriceMap shape stays the same.
 *
 * Keyed by normalised symbol ("ONDO/USDT" -> "ONDOUSDT") so it matches Signal.symbol directly.
 */

// C# exchange display name -> ccxt id + market type.
const EXCHANGE_MAP: Record<string, { id: string; type: 'spot' | 'swap' }> = {
  'Bybit Spot': { id: 'bybit', type: 'spot' },
  'OKX Spot': { id: 'okx', type: 'spot' },
  'OKX Futures': { id: 'okx', type: 'swap' },
  'Coinbase Spot': { id: 'coinbase', type: 'spot' },
  'Kraken Spot': { id: 'kraken', type: 'spot' },
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

  private async poll(): Promise<void> {
    if (!this.ex) return
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
