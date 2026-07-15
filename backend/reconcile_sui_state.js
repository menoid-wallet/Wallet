/**
 * reconcile_sui_state.js
 *
 * Replays the Sui pool's on-chain NoteCreatedEvent history into the DB so the
 * backend's Merkle tree matches the chain exactly.
 *
 * WHY THIS EXISTS
 * ---------------
 * The backend treats the DB as the source of truth (suiIndexer.js does no
 * on-chain scanning) and only learns about commitments from deposits/transfers
 * it broadcasts itself. Any commitment inserted on-chain by some other path
 * leaves the DB tree short a leaf — and then every Merkle proof the backend
 * builds is against a root the chain has never seen, so every transfer/withdraw
 * fails.
 *
 * This queries the chain for NoteCreatedEvent in emission order and rebuilds the
 * DB's PoolState from it. Emission order IS insertion order, which is what makes
 * the replay sound.
 *
 * USAGE
 *   node reconcile_sui_state.js --dry-run   # compare DB vs chain, no writes
 *   node reconcile_sui_state.js             # rewrite DB PoolState from chain
 */
require("dotenv").config();
const mongoose = require("mongoose");
const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const { suiClient, packageId, poolStateId } = require("./src/config/suiProvider");
const PoolState = require("./src/models/PoolState");

async function fetchNoteEvents() {
    const out = [];
    let cursor = null;
    for (;;) {
        const page = await suiClient.queryEvents({
            query: { MoveEventType: `${packageId}::pool::NoteCreatedEvent` },
            cursor,
            order: "ascending", // emission order == insertion order
            limit: 50,
        });
        out.push(...page.data);
        if (!page.hasNextPage || !page.nextCursor) break;
        cursor = page.nextCursor;
    }
    return out;
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected. Mode: ${dryRun ? "DRY RUN" : "REWRITE"}`);
    console.log(`package: ${packageId}`);
    console.log(`pool:    ${poolStateId}\n`);

    const events = await fetchNoteEvents();
    console.log(`on-chain NoteCreatedEvent count: ${events.length}`);

    // group by pool id, preserving order
    const byPool = {};
    for (const e of events) {
        const j = e.parsedJson;
        const poolId = String(j.pool_id);
        (byPool[poolId] ||= []).push({
            commitment: String(j.commitment),
            encryptedNote: Buffer.from(j.encrypted_note).toString("hex"),
        });
    }

    const poseidon = await circomlibjs.buildPoseidon();
    const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs)));

    for (const [poolId, notes] of Object.entries(byPool)) {
        const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);
        const commitments = [];
        const roots = [];
        const leafToIndex = new Map();
        const encryptedNotes = new Map();

        for (const { commitment, encryptedNote } of notes) {
            tree.insert(BigInt(commitment));
            const leafIndex = tree.leaves.length - 1;
            commitments.push(commitment);
            roots.push(tree.root.toString());
            leafToIndex.set(commitment, leafIndex);
            encryptedNotes.set(commitment, encryptedNote);
        }
        const latestRoot = roots[roots.length - 1] || null;

        const existing = await PoolState.findOne({ network: "sui", poolId });
        console.log(`\n── pool ${poolId} ──`);
        console.log(`   chain: ${commitments.length} commitment(s)  latestRoot=${latestRoot}`);
        console.log(
            `   db   : ${existing?.commitments?.length ?? 0} commitment(s)  ` +
            `latestRoot=${existing?.latestRoot ?? "(none)"}`
        );

        const inSync =
            existing &&
            existing.commitments.length === commitments.length &&
            existing.latestRoot === latestRoot;

        if (inSync) {
            console.log("   already in sync ✓");
            continue;
        }

        if (dryRun) {
            console.log("   OUT OF SYNC — would rewrite the DB PoolState from chain");
            continue;
        }

        await PoolState.findOneAndUpdate(
            { network: "sui", poolId },
            {
                network: "sui",
                poolId,
                commitments,
                roots,
                latestRoot,
                leafToIndex,
                encryptedNotes,
                lastProcessedBlock: 0,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log("   rewritten from chain ✓");
    }

    if (!Object.keys(byPool).length) {
        console.log("\nNo NoteCreatedEvents on chain — nothing to reconcile.");
    }

    await mongoose.disconnect();
    console.log(dryRun ? "\nDRY RUN complete." : "\nDone.");
}

main().catch((e) => {
    console.error("reconcile_sui_state failed:", e);
    process.exit(1);
});
