import { createContext, useContext } from 'react'
import type { PriceMap } from '@csb/shared'

// Live last-price per symbol, fed by the bridge's ticker feed. Mirrors the old app's
// TickerContext: the Change cell reads from here so it re-renders as prices flush,
// without threading prices through the (memoised, static) column definitions.
export const PricesContext = createContext<PriceMap>({})

export const usePrices = () => useContext(PricesContext)
