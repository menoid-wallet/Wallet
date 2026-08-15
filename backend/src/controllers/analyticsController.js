const Install = require("../models/Install");
const AnalyticsEvent = require("../models/AnalyticsEvent");

/** Only these ever become columns; anything else a client sends is ignored. */
const STATUSES = new Set(["success", "failure", "cancelled"]);

const clamp = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);

/**
 * Keys that must never be persisted, mirroring the client-side filter.
 *
 * DELIBERATELY DUPLICATED. The clients already scrub, but a client is not a
 * trust boundary: an older build, a bug, or anything replaying this endpoint by
 * hand can send whatever it likes, and this collection is the thing that
 * actually remembers. The last chance to not store a commitment is here.
 */
const BANNED_KEYS = [
  "seed", "mnemonic", "phrase", "privatekey", "privkey", "secret", "sk",
  "commitment", "randomness", "nullifier", "note",
  "address", "recipient", "to", "from", "txhash", "hash", "signature",
  "amount", "value", "balance",
];

function scrubProps(props) {
  if (!props || typeof props !== "object") return undefined;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const key = k.toLowerCase();
    if (BANNED_KEYS.some((bad) => key === bad || key.endsWith(bad))) continue;
    if (typeof v === "string" && v.length > 200) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * POST /api/analytics/install
 *
 * Idempotent by design: the client calls this on EVERY launch, not just the
 * first. An unknown id creates the row (one install), a known one bumps
 * lastSeen and the session counter. Making the client decide "is this my first
 * run?" would lose the install whenever that one call failed.
 */
async function registerInstall(req, res) {
  try {
    const { installId, platform, appVersion, osVersion, deviceModel, locale } = req.body || {};
    if (!installId || !platform) {
      return res.status(400).json({ error: "installId and platform are required" });
    }

    const now = new Date();
    const doc = await Install.findOneAndUpdate(
      { installId: clamp(installId, 64) },
      {
        $set: {
          platform: clamp(platform, 20),
          appVersion: clamp(appVersion, 20),
          osVersion: clamp(osVersion, 40),
          deviceModel: clamp(deviceModel, 60),
          locale: clamp(locale, 20),
          lastSeen: now,
        },
        $setOnInsert: { firstSeen: now },
        $inc: { sessions: 1 },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    res.json({ success: true, firstSeen: doc.firstSeen, sessions: doc.sessions });
  } catch (e) {
    console.error("[analytics] install failed:", e.message);
    res.status(500).json({ error: "could not record install" });
  }
}

/**
 * POST /api/analytics/events   { installId, platform, appVersion, events: [...] }
 *
 * Takes a BATCH, because the client buffers. One request per tap would put a
 * network round trip on the critical path of every interaction, which is the
 * opposite of what analytics is for.
 *
 * Unknown fields are dropped rather than rejected: a slightly older client
 * sending a field we no longer read should still have its event counted, and a
 * malformed event should never cost us the other nineteen in the batch.
 */
async function ingestEvents(req, res) {
  try {
    const { installId, platform, appVersion, events } = req.body || {};
    if (!installId || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: "installId and a non-empty events array are required" });
    }
    if (events.length > 200) {
      return res.status(413).json({ error: "too many events in one batch" });
    }

    const docs = events
      .filter((e) => e && typeof e.name === "string")
      .map((e) => ({
        installId: clamp(installId, 64),
        platform: clamp(platform, 20),
        appVersion: clamp(appVersion, 20),
        name: clamp(e.name, 60),
        network: clamp(e.network, 20),
        status: STATUSES.has(e.status) ? e.status : undefined,
        durationMs: num(e.durationMs),
        batchCount: num(e.batchCount),
        batchSizes: Array.isArray(e.batchSizes) ? e.batchSizes.slice(0, 32).map(Number) : undefined,
        proofMs: num(e.proofMs),
        errorKind: clamp(e.errorKind, 60),
        props: scrubProps(e.props),
        occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
      }));

    if (docs.length === 0) return res.json({ success: true, accepted: 0 });

    // ordered:false so one bad document cannot discard the rest of the batch.
    await AnalyticsEvent.insertMany(docs, { ordered: false });
    await Install.updateOne({ installId }, { $set: { lastSeen: new Date() } });

    res.json({ success: true, accepted: docs.length });
  } catch (e) {
    console.error("[analytics] ingest failed:", e.message);
    res.status(500).json({ error: "could not record events" });
  }
}

/**
 * GET /api/analytics/summary?days=30
 *
 * The dashboard, such as it is: installs, actives, and event/error tallies.
 */
async function getSummary(req, res) {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86400000);
    const dayAgo = new Date(Date.now() - 86400000);

    const [totalInstalls, byPlatform, newInstalls, activeToday, byName, failures] =
      await Promise.all([
        Install.countDocuments({}),
        Install.aggregate([{ $group: { _id: "$platform", count: { $sum: 1 } } }]),
        Install.countDocuments({ firstSeen: { $gte: since } }),
        Install.countDocuments({ lastSeen: { $gte: dayAgo } }),
        AnalyticsEvent.aggregate([
          { $match: { occurredAt: { $gte: since } } },
          { $group: { _id: { name: "$name", status: "$status" }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        AnalyticsEvent.aggregate([
          { $match: { occurredAt: { $gte: since }, status: "failure" } },
          {
            $group: {
              _id: { name: "$name", network: "$network", errorKind: "$errorKind" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 50 },
        ]),
      ]);

    res.json({
      windowDays: days,
      installs: { total: totalInstalls, new: newInstalls, activeLast24h: activeToday, byPlatform },
      events: byName,
      failures,
    });
  } catch (e) {
    console.error("[analytics] summary failed:", e.message);
    res.status(500).json({ error: "could not build summary" });
  }
}

/**
 * GET /api/analytics/timings?days=30
 *
 * How long the expensive things take, on real devices. This is the number that
 * decides whether private sends are usable, and the emulator cannot tell us.
 */
async function getTimings(req, res) {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86400000);

    const rows = await AnalyticsEvent.aggregate([
      { $match: { occurredAt: { $gte: since }, durationMs: { $gt: 0 } } },
      {
        $group: {
          _id: { name: "$name", network: "$network" },
          n: { $sum: 1 },
          avgMs: { $avg: "$durationMs" },
          minMs: { $min: "$durationMs" },
          maxMs: { $max: "$durationMs" },
          avgProofMs: { $avg: "$proofMs" },
          avgBatches: { $avg: "$batchCount" },
        },
      },
      { $sort: { n: -1 } },
    ]);

    res.json({ windowDays: days, timings: rows });
  } catch (e) {
    console.error("[analytics] timings failed:", e.message);
    res.status(500).json({ error: "could not build timings" });
  }
}

module.exports = { registerInstall, ingestEvents, getSummary, getTimings };
