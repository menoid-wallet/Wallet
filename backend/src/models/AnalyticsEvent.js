const mongoose = require("mongoose");

/**
 * AnalyticsEvent
 *
 * Every notable thing that happens in the wallet, one document each.
 *
 * The shape is deliberately half-structured: the fields worth querying and
 * aggregating are columns, and everything else goes in `props`. A pure blob
 * would make "average proof time on Monad last week" an application-level
 * problem instead of a one-line aggregation.
 *
 * WHAT MUST NEVER LAND HERE — this is a privacy wallet, and the backend is
 * also the relayer, so it is the one place where careless logging does real
 * damage:
 *
 *   · no seed phrases, private keys or spending keys, ever
 *   · no note commitments, randomness or nullifiers — those identify a note
 *   · no recipient addresses on private sends
 *   · no exact amounts on private flows
 *
 * COUNTS AND TIMINGS ONLY for anything in noid mode. "Four notes in two
 * batches, 9.4 seconds" is what makes the feature better. "Four notes worth
 * 2.1 MON to 0xabc…" is a deanonymisation record, and the fact that we would
 * be the ones holding it is not a defence.
 */
const analyticsEventSchema = new mongoose.Schema(
  {
    installId: { type: String, required: true, index: true },
    /** "android" | "extension" */
    platform: { type: String, required: true, index: true },
    appVersion: { type: String },

    /** e.g. wallet_created, hide_succeeded, proof_generated */
    name: { type: String, required: true, index: true },

    /** monad | sepolia | base_sepolia | solana | sui | aptos */
    network: { type: String, index: true },

    /** "success" | "failure" | "cancelled" — null for events with no outcome */
    status: { type: String, index: true },

    /** Wall-clock duration in ms, where the event measures something. */
    durationMs: { type: Number },

    /* ── private-flow shape, counts only ───────────────────────────────── */
    /** proofs required, i.e. how many groups of four notes were spent */
    batchCount: { type: Number },
    /** notes consumed per batch, e.g. [4, 2] */
    batchSizes: { type: [Number], default: undefined },
    /** how long the groth16 proving took, summed across batches */
    proofMs: { type: Number },

    /** Error class, never a raw message — messages can carry addresses. */
    errorKind: { type: String },

    /** Anything else. Free-form, and subject to the rules in the header. */
    props: { type: mongoose.Schema.Types.Mixed },

    /** When it happened ON THE DEVICE. `createdAt` is when we received it,
        and the two differ whenever a client flushes a queue after being
        offline — which is exactly when you want to know the difference. */
    occurredAt: { type: Date, index: true },
  },
  { timestamps: true }
);

/* The two questions actually asked of this collection: "what happened to this
   install, in order" and "how did <event> do over time". */
analyticsEventSchema.index({ installId: 1, occurredAt: -1 });
analyticsEventSchema.index({ name: 1, occurredAt: -1 });

module.exports = mongoose.model("AnalyticsEvent", analyticsEventSchema);
