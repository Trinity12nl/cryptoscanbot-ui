// Chart deep-links for a signal row. Ported from the old web app - works directly
// with the oracle's string exchange/symbol/interval names. TradingView for now;
// shape stays extensible for Altrady etc.

export type ChartLinkProvider = 'tradingview'

const STORAGE_KEY = 'csb.chartLinkProvider'

export function getChartLinkProvider(): ChartLinkProvider {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'tradingview') return 'tradingview'
  } catch { /* localStorage unavailable */ }
  return 'tradingview'
}

// Exchange display name -> TradingView exchange prefix.
const TV_EXCHANGE_PREFIX: Record<string, string> = {
  'Bybit Spot': 'BYBIT',
  'OKX Spot': 'OKX',
  'OKX Futures': 'OKX',
  'Coinbase Spot': 'COINBASE',
  'Kraken Spot': 'KRAKEN',
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
  const isPerp = symbolName.includes(':')
  const base = symbolName.split(':')[0] ?? symbolName
  const symbol = base.replace(/[/-]/g, '') + (isPerp ? '.P' : '')
  if (provider === 'tradingview') {
    const prefix = (exchangeName && TV_EXCHANGE_PREFIX[exchangeName]) ?? 'BYBIT'
    const tv = (intervalName && TV_INTERVAL[intervalName]) ?? '1'
    return `https://www.tradingview.com/chart/?symbol=${prefix}:${symbol}&interval=${tv}`
  }
  return null
}
