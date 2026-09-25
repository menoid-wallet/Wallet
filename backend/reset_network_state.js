/**
 * reset_network_state.js
 *
 * Clears the cached pool state for one or more networks.
 *
 * WHY THIS EXISTS
 * ---------------
 * PoolState / NoteState / NullifierState / NoidRegistration are keyed by
 * NETWORK NAME ("monad", "sepolia", ...), not by pool address. So when a pool
 * is redeployed to a new address, the documents for that network still describe
 * the OLD pool: old commitments, old Merkle roots, old nullifiers, old
 * registrations. The relayer would then build proofs against a tree that does
 * not exist on-chain, and every proof would be rejected.
 *
 * Run this for any network whose pool changed. A network whose pool was kept
 * (verifying key swapped in place, same address) must NOT be reset — its
 * documents still describe the live tree.
 *
 * USAGE
 *   node reset_network_state.js --dry-run --all            # count everything
 *   node reset_network_state.js --all                      # delete everything
 *   node reset_network_state.js --dry-run monad sepolia    # count two
 *   node reset_network_state.js monad sepolia              # delete two
 *
 * This is destructive and cannot be undone. --dry-run first.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const PoolState = require("./src/models/PoolState");
const NoteState = require("./src/models/NoteState");
const NullifierState = require("./src/models/NullifierState");
const NoidRegistration = require("./src/models/NoidRegistration");

const VALID = ["monad", "sepolia", "base_sepolia", "solana", "sui", "aptos"];

const MODELS = [
    ["PoolState", PoolState],
    ["NoteState", NoteState],
    ["NullifierState", NullifierState],
    ["NoidRegistration", NoidRegistration],
];

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    // --all is the normal case after a full redeploy; naming six networks by
    // hand is how one gets left behind, and a network left behind serves proofs
    // against a Merkle root that no longer exists on-chain.
    const networks = args.includes("--all")
        ? [...VALID]
        : args.filter((a) => !a.startsWith("--"));

    if (!networks.length) {
        console.error("Usage: node reset_network_state.js [--dry-run] (--all | <network>...)");
        console.error(`Valid networks: ${VALID.join(", ")}`);
        process.exit(1);
    }

    const bad = networks.filter((n) => !VALID.includes(n));
    if (bad.length) {
        console.error(`Unknown network(s): ${bad.join(", ")}`);
        console.error(`Valid networks: ${VALID.join(", ")}`);
        process.exit(1);
    }

    if (!process.env.MONGO_URI) {
        console.error("MONGO_URI is not set");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected. Mode: ${dryRun ? "DRY RUN (no writes)" : "DELETE"}`);
    console.log(`Networks: ${networks.join(", ")}\n`);

    let total = 0;

    for (const network of networks) {
        console.log(`── ${network} ──`);
        for (const [label, Model] of MODELS) {
            const count = await Model.countDocuments({ network });
            if (dryRun) {
                console.log(`   ${label.padEnd(18)} ${count} document(s) would be deleted`);
            } else if (count === 0) {
                console.log(`   ${label.padEnd(18)} nothing to delete`);
            } else {
                const res = await Model.deleteMany({ network });
                console.log(`   ${label.padEnd(18)} deleted ${res.deletedCount}`);
            }
            total += count;
        }
        console.log("");
    }

    console.log(
        dryRun
            ? `DRY RUN complete — ${total} document(s) would be removed. Re-run without --dry-run to apply.`
            : `Done — ${total} document(s) removed.`
    );

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("reset_network_state failed:", err);
    process.exit(1);
});
