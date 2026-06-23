/**
 * prices.ts
 *
 * Live market data for the wallet. Every supported chain runs on a
 * *testnet*, so the on-chain token amounts are real but carry no market
 * value. To give the UI a meaningful valuation we map each testnet to its
 * mainnet counterpart and pull live USD prices + historical charts from
 * CoinGecko's public API.
 *
 *   monad         → monad
 *   sepolia       → ethereum
 *   base_sepolia  → ethereum
 *   solana        → solana
 *   sui           → sui
 *   aptos         → aptos
 *
 * Both calls are cached at module scope (and de-duped while in-flight) so
 * the open + noid views, which both poll, never hammer the rate-limited
 * free tier.
 *
 * NOTE: `https://api.coingecko.com` must be present in the extension's
 * `connect-src` CSP (see package.json → manifest.content_security_policy).
 */

import type { NetworkId } from "../lib/networks"

const API = "https://api.coingecko.com/api/v3"

/** testnet network → mainnet CoinGecko coin id */
export const COINGECKO_IDS: Record<NetworkId, string> = {
  monad: "monad",
  sepolia: "ethereum",
  base_sepolia: "ethereum",
  solana: "solana",
  sui: "sui",
  aptos: "aptos"
}

export interface PriceInfo {
  /** spot price in USD */
  usd: number
  /** 24h change, percent */
  change24h: number
}

export type PriceMap = Record<NetworkId, PriceInfo>

export type ChartRange = "1" | "7" | "30" | "365"

const EMPTY_PRICE: PriceInfo = { usd: 0, change24h: 0 }

// ─── Price cache ────────────────────────────────────────────────────────────
const PRICE_TTL = 45_000
let priceCache: { at: number; data: PriceMap } | null = null
let priceInflight: Promise<PriceMap> | null = null

/**
 * Live USD price + 24h change for every supported chain, in one request.
 * Cached for `PRICE_TTL`; concurrent callers share the in-flight promise.
 */
export async function fetchAllPrices(): Promise<PriceMap> {
  const now = Date.now()
  if (priceCache && now - priceCache.at < PRICE_TTL) return priceCache.data
  if (priceInflight) return priceInflight

  priceInflight = (async () => {
    const ids = Array.from(new Set(Object.values(COINGECKO_IDS))).join(",")
    const res = await fetch(
      `${API}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
    )
    if (!res.ok) throw new Error(`price fetch failed (${res.status})`)
    const json = await res.json()

    const data = {} as PriceMap
    for (const net of Object.keys(COINGECKO_IDS) as NetworkId[]) {
      const cg = json[COINGECKO_IDS[net]]
      data[net] = cg
        ? { usd: Number(cg.usd) || 0, change24h: Number(cg.usd_24h_change) || 0 }
        : { ...EMPTY_PRICE }
    }
    priceCache = { at: Date.now(), data }
    return data
  })()

  try {
    return await priceInflight
  } finally {
    priceInflight = null
  }
}

/** Last successfully fetched prices, if any (no network call). */
export function getCachedPrices(): PriceMap | null {
  return priceCache?.data ?? null
}

// ─── Chart cache ────────────────────────────────────────────────────────────
const CHART_TTL = 120_000
const chartCache: Record<string, { at: number; points: number[] }> = {}
const chartInflight: Record<string, Promise<number[]>> = {}

/** Reduce a dense price series down to ~`target` evenly-spaced points. */
function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr
  const step = arr.length / target
  const out: number[] = []
  for (let i = 0; i < target; i++) out.push(arr[Math.floor(i * step)])
  out.push(arr[arr.length - 1])
  return out
}

/**
 * Historical USD price series for one chain's mainnet token.
 * Returns a plain `number[]` (oldest → newest), downsampled for a light SVG.
 */
export async function fetchChart(
  network: NetworkId,
  range: ChartRange = "7"
): Promise<number[]> {
  const id = COINGECKO_IDS[network]
  const key = `${id}:${range}`
  const now = Date.now()

  const cached = chartCache[key]
  if (cached && now - cached.at < CHART_TTL) return cached.points
  if (chartInflight[key]) return chartInflight[key]

  chartInflight[key] = (async () => {
    // No `interval` param — that's enterprise-gated on the free tier and
    // would 401. CoinGecko auto-picks granularity from `days`; we downsample.
    const res = await fetch(
      `${API}/coins/${id}/market_chart?vs_currency=usd&days=${range}`
    )
    if (!res.ok) throw new Error(`chart fetch failed (${res.status})`)
    const json = await res.json()
    const raw: number[] = Array.isArray(json?.prices)
      ? json.prices.map((p: [number, number]) => p[1]).filter((n: number) => Number.isFinite(n))
      : []
    const points = downsample(raw, 56)
    chartCache[key] = { at: Date.now(), points }
    return points
  })()

  try {
    return await chartInflight[key]
  } finally {
    delete chartInflight[key]
  }
}
