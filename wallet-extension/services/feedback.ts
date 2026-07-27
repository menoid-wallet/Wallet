/**
 * feedback.ts
 *
 * Tiny client for the backend feedback survey endpoint.
 *
 *   POST /feedback/create   → one survey submission
 *   GET  /feedback/all      → all submissions (admin)
 *
 * Field names mirror the Feedback mongoose model on the backend.
 */

import { BASE_URL } from "./api"

export type PirateTheme = "loved" | "liked" | "neutral" | "disliked"
export type MostImpressive = "noid" | "multichain" | "ui"
export type Recommend =
  | "definitely"
  | "probably"
  | "maybe"
  | "probably_not"
  | "no"
export type BuildNext =
  | "private_swaps"
  | "private_prediction_markets"
  | "private_memecoin_launchpad"
  | "private_dapps"
  | "more_chains"
  | "ai_assistant"

export interface FeedbackPayload {
  setupEase?: number // Q1 1-5
  uiUxRating?: number // Q2 1-5
  noidRating?: number // Q3 1-5
  pirateTheme?: PirateTheme // Q4 (purple cloudy theme)
  confusing?: string // Q5
  buildNext?: BuildNext[] // Q6 multi
  primaryWalletNps?: number // Q7 1-10
  improve?: string // Q8
  recommend?: Recommend // Q9
  additional?: string // Q10
  email: string
  discord?: string
  twitter?: string
  walletAddress?: string
  mode?: "open" | "noid"
}

export async function submitFeedback(
  payload: FeedbackPayload
): Promise<{ _id: string }> {
  const res = await fetch(`${BASE_URL}/feedback/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(
      (errBody as any)?.error ?? `Failed to submit feedback (${res.status})`
    )
  }
  return res.json()
}
