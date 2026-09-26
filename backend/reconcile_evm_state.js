/**
 * reconcile_evm_state.js — rebuild an EVM pool's DB tree from the chain.
 *
 * Accepts a result ONLY if it hashes to the contract's current root, so it can
 * never write a tree the chain disagrees with. See src/helpers/reconcileEvm.js.
 *
 * Run it whenever a note is on-chain but missing from a wallet, or transfers
 * fail with "Invalid root":
 *
 *   node reconcile_evm_state.js --dry-run monad
 *   node reconcile_evm_state.js monad
 *   node reconcile_evm_state.js --all
 *
 * Restart the backend afterwards: it holds a copy of each tree in memory.
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { reconcilePool } = require("./src/helpers/reconcileEvm");

const VALID = ["monad", "sepolia", "base_sepolia"];

(async () => {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const networks = args.includes("--all") ? VALID : args.filter((a) => !a.startsWith("--"));
    if (!networks.length || networks.some((n) => !VALID.includes(n))) {
        console.error(`Usage: node reconcile_evm_state.js [--dry-run] (--all | ${VALID.join(" | ")})`);
        process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);
    for (const n of networks) await reconcilePool(n, "0", { dryRun });
    await mongoose.disconnect();
})().catch((e) => { console.error("reconcile failed:", e.message); process.exit(1); });
