/**
 * feedback.ts
 *
 * Local persistence for the in-wallet feedback survey. Once a user submits
 * their feedback we remember it in the extension's local storage so the form
 * re-opens in its "already submitted" state instead of asking again.
 *
 * Storage key: "menoid_feedback_v1" → { submitted, at, email }
 */

export const FEEDBACK_KEY = "menoid_feedback_v1"

export interface FeedbackRecord {
  submitted: boolean
  /** epoch ms of submission */
  at: number
  /** email used (for display in the thank-you state) */
  email: string
}

export async function getFeedbackRecord(): Promise<FeedbackRecord | null> {
  try {
    const result = await chrome.storage.local.get(FEEDBACK_KEY)
    const rec = result?.[FEEDBACK_KEY] as FeedbackRecord | undefined
    return rec && rec.submitted ? rec : null
  } catch {
    return null
  }
}

export async function markFeedbackSubmitted(email: string): Promise<void> {
  try {
    await chrome.storage.local.set({
      [FEEDBACK_KEY]: { submitted: true, at: Date.now(), email }
    })
  } catch {
    /* ignore */
  }
}
