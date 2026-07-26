// Chart deep-links for a signal row. Works directly with the oracle's string
// exchange/symbol/interval names. TradingView for now; shape stays extensible for
// Altrady etc.
//
// The per-exchange TradingView symbol format is the source of truth from the C#
// scanner's `CryptoScanner.Core/Exchange/<name>/<market>/Api.cs` (GetExchangeLinks
// -> TradingView.Url) and the exchange names from its Database.cs seed. TradingView
// symbols are `PREFIX:BASEQUOTE` and perpetual-futures markets add a `.P` suffix
// (Kraken Futures is the odd one out: the `.P` sits on the prefix, `KRAKEN.P:...`).

export type ChartLinkProvider = 'tradingview'

const STORAGE_KEY = 'csb.chartLinkProvider'

export function getChartLinkProvider(): ChartLinkProvider {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'tradingview') return 'tradingview'
  } catch { /* localStorage unavailable */ }
  return 'tradingview'
}

// Oracle exchange name (Database.cs seed) -> TradingView symbol format.
// `prefix` is the TV exchange code; `suffix` (default '') is appended after the
// symbol - `.P` for perpetual futures. Mirrors api.cs GetExchangeLinks().TradingView.
interface TvFormat {
  prefix: string
  suffix?: string
}

const TV_EXCHANGE: Record<string, TvFormat> = {
  'Binance Spot': { prefix: 'BINANCE' },
  'Binance Futures': { prefix: 'BINANCE', suffix: '.P' },
  'Bitvavo Spot': { prefix: 'BITVAVO' },
  'BloFin Futures': { prefix: 'BLOFIN', suffix: '.P' },
  'Bybit Spot': { prefix: 'BYBIT' },
  'Bybit Futures': { prefix: 'BYBIT', suffix: '.P' },
  'Bybit EU Spot': { prefix: 'BYBIT' },
  'Bybit EU Futures': { prefix: 'BYBIT', suffix: '.P' },
  'Coinbase Spot': { prefix: 'GDAX' },
  'HyperLiquid Spot': { prefix: 'HYPERLIQUID' },
  'HyperLiquid Futures': { prefix: 'HYPERLIQUID', suffix: '.P' },
  'Kraken Spot': { prefix: 'KRAKEN' },
  'Kraken Futures': { prefix: 'KRAKEN.P' },
  'Kucoin Spot': { prefix: 'KUCOIN' },
  'Kucoin Futures': { prefix: 'KUCOIN', suffix: '.P' },
  'Mexc Spot': { prefix: 'MEXC' },
  'Okx Spot': { prefix: 'OKEX' },
  'Okx Futures': { prefix: 'OKEX' },
}

// Interval name -> TradingView interval code (minutes, or D/W).
const TV_INTERVAL: Record<string, string> = {
  '1m': '1', '3m': '3', '5m': '5', '10m': '10', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '6h': '360', '8h': '480', '12h': '720',
  '1d': 'D', '1w': 'W',
}

export function buildChartUrl(
  provider: ChartLinkProvider,
  exchangeName: string | undefined,
  symbolName: string | undefined,
  intervalName: string | undefined,
): string | null {
  if (symbolName == null || symbolName === '') return null
  // Oracle symbol names are already BASEQUOTE (e.g. BTCUSDT); strip any stray
  // separators and uppercase to be safe, then apply the exchange's TV format.
  const symbol = symbolName.replace(/[/:-]/g, '').toUpperCase()
  if (provider === 'tradingview') {
    const fmt = (exchangeName && TV_EXCHANGE[exchangeName]) ?? null
    const tv = (intervalName && TV_INTERVAL[intervalName]) ?? '1'
    // Unknown exchange: fall back to a bare symbol (TradingView resolves a default)
    // rather than guessing a wrong exchange prefix.
    const tvSymbol = fmt ? `${fmt.prefix}:${symbol}${fmt.suffix ?? ''}` : symbol
    return `https://www.tradingview.com/chart/?symbol=${tvSymbol}&interval=${tv}`
  }
  return null
}
