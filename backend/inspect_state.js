/**
 * inspect_state.js — READ ONLY.
 *
 * Prints what the backend DB believes about each network's pool, so a
 * redeploy/migration can be reconciled against on-chain reality.
 *
 * The backend treats the DB as the source of truth (poolIndexer.js does no
 * on-chain scanning), so any commitment inserted on-chain WITHOUT going through
 * the backend leaves the DB tree short a leaf — and every Merkle proof it builds
 * afterwards is against a root that does not exist on-chain.
 *
 * Usage: node inspect_state.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

const PoolState = require("./src/models/PoolState");
const NoteState = require("./src/models/NoteState");
const NullifierState = require("./src/models/NullifierState");
const NoidRegistration = require("./src/models/NoidRegistration");

const NETWORKS = ["monad", "sepolia", "base_sepolia", "solana", "sui", "aptos"];

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected (read-only)\n");

    for (const network of NETWORKS) {
        const pools = await PoolState.find({ network });
        const notes = await NoteState.countDocuments({ network });
        const nulls = await NullifierState.find({ network });
        const regs = await NoidRegistration.countDocuments({ network });

        const nullCount = nulls.reduce((s, n) => s + (n.nullifiers?.length || 0), 0);

        console.log(`── ${network} ──`);
        console.log(`   PoolState docs      : ${pools.length}`);
        for (const p of pools) {
            console.log(
                `     pool ${p.poolId}: ${p.commitments.length} commitment(s), ` +
                `${p.roots.length} root(s)`
            );
            console.log(`       latestRoot: ${p.latestRoot ?? "(none)"}`);
        }
        console.log(`   NoteState docs      : ${notes}`);
        console.log(`   NullifierState docs : ${nulls.length} (${nullCount} nullifier(s))`);
        console.log(`   NoidRegistration    : ${regs}`);
        console.log("");
    }

    await mongoose.disconnect();
}

main().catch((e) => {
    console.error("inspect_state failed:", e);
    process.exit(1);
});
