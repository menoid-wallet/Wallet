const mongoose = require("mongoose");

/**
 * Feedback
 *
 * Stores the in-wallet feedback survey. Field names map 1:1 to the
 * questions rendered by the extension's FeedbackModal:
 *
 *   Q1  setupEase        ⭐ 1–5
 *   Q2  uiUxRating       ⭐ 1–5
 *   Q3  pirateTheme      loved | liked | neutral | disliked
 *   Q4  mostImpressive   noid | multichain | ui
 *   Q5  confusing        long text
 *   Q6  buildNext        [] multi-select
 *   Q7  primaryWalletNps ⭐ 1–10 (NPS)
 *   Q8  improve          long text
 *   Q9  recommend        definitely | probably | maybe | probably_not | no
 *   Q10 additional       long text
 *
 * Plus contact info (email required for the post-v3 airdrop email, the
 * two socials optional) and a little context about the wallet that sent it.
 */
const feedbackSchema = new mongoose.Schema(
  {
    // ── Ratings ─────────────────────────────────────────────────────────
    setupEase: { type: Number, min: 1, max: 5 },
    uiUxRating: { type: Number, min: 1, max: 5 },
    primaryWalletNps: { type: Number, min: 1, max: 10 },

    // ── Single choice ───────────────────────────────────────────────────
    pirateTheme: {
      type: String,
      enum: ["loved", "liked", "neutral", "disliked"]
    },
    mostImpressive: {
      type: String,
      enum: ["noid", "multichain", "ui"]
    },
    recommend: {
      type: String,
      enum: ["definitely", "probably", "maybe", "probably_not", "no"]
    },

    // ── Multi select ────────────────────────────────────────────────────
    buildNext: {
      type: [String],
      default: []
    },

    // ── Free text ───────────────────────────────────────────────────────
    confusing: { type: String, trim: true, default: "" },
    improve: { type: String, trim: true, default: "" },
    additional: { type: String, trim: true, default: "" },

    // ── Contact ─────────────────────────────────────────────────────────
    email: { type: String, required: true, trim: true, lowercase: true },
    discord: { type: String, trim: true, default: "" },
    twitter: { type: String, trim: true, default: "" },

    // ── Context (best-effort, never required) ───────────────────────────
    walletAddress: { type: String, trim: true, default: "" },
    mode: { type: String, enum: ["open", "noid"], default: "open" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Feedback", feedbackSchema);
