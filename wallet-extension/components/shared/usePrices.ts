/**
 * usePrices.ts
 *
 * Thin React bindings over services/prices. The module-level cache there
 * means many hook instances (open view, noid view, coin pages) collapse
 * into a single network request per TTL window.
 */

import { useEffect, useRef, useState } from "react"
import type { NetworkId } from "../../lib/networks"
import {
  fetchAllPrices,
  fetchChart,
  getCachedPrices,
  type ChartRange,
  type PriceMap
} from "../../services/prices"

/**
 * Live USD prices + 24h change for all chains, polled while visible.
 * Seeds from the module cache so a remount paints instantly.
 */
export function useTokenPrices(pollMs = 60_000) {
  const [prices, setPrices] = useState<PriceMap | null>(() => getCachedPrices())
  const [loading, setLoading] = useState(!getCachedPrices())

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const p = await fetchAllPrices()
        if (alive) {
          setPrices(p)
          setLoading(false)
        }
      } catch {
        if (alive) setLoading(false)
      }
    }
    void load()
    const id = setInterval(() => {
      if (!document.hidden) void load()
    }, pollMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [pollMs])

  return { prices, loading }
}

/**
 * Historical price series for one chain + range. Re-fetches when either
 * changes; keeps the previous series on screen until the new one lands so
 * the chart never flashes empty between range switches.
 */
export function useTokenChart(network: NetworkId, range: ChartRange) {
  const [points, setPoints] = useState<number[] | null>(null)
  const [loading, setLoading] = useState(true)
  const reqRef = useRef(0)

  useEffect(() => {
    const req = ++reqRef.current
    setLoading(true)
    fetchChart(network, range)
      .then((p) => {
        if (reqRef.current === req) {
          setPoints(p)
          setLoading(false)
        }
      })
      .catch(() => {
        if (reqRef.current === req) {
          setPoints(null)
          setLoading(false)
        }
      })
  }, [network, range])

  return { points, loading }
}
