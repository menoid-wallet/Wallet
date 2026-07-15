/**
 * drain_aptos_pending.js
 *
 * Drains any commitments stuck in the Aptos pool's pending_commitments queue and
 * records them in the DB, in one consistent operation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Aptos has no native Poseidon, so deposit/transfer/withdraw only QUEUE their
 * output commitments; the relayer must then call pool::update_root once per
 * queued commitment with a `new_root` ZK proof. The contract REJECTS any new
 * deposit/transfer/withdraw while pending_commitments is non-empty
 * (E_PENDING_TASKS), so a half-finished sequence leaves the pool BLOCKED.
 *
 * That happens if a deposit is ever submitted directly rather than through the
 * backend route (which drains as part of the same mutex-held sequence).
 *
 * This reuses the backend's own helpers (buildNewRootProofs +
 * appendCommitmentsAtomic) so the on-chain tree and the DB advance together —
 * the DB is the source of truth for Merkle proofs, so it must end up holding
 * exactly the leaves the chain holds.
 *
 * USAGE
 *   node drain_aptos_pending.js --dry-run    # report only
 *   node drain_aptos_pending.js              # drain + persist
 */
require("dotenv").config();
const mongoose = require("mongoose");

const { aptos, relayerAccount, moduleAddr, poolAddr } = require("./src/config/aptosProvider");
const { aptosPoolStates, initializeAptosPool } = require("./src/indexer/aptosIndexer");
const { buildNewRootProofs, subtreesHash } = require("./src/helpers/aptosNewRoot");
const { appendCommitmentsAtomic } = require("./src/helpers/poolUpdate");

const POOL_ID = "0";

async function viewPool(fn, args) {
    return aptos.view({
        payload: {
            function: `${moduleAddr}::pool::${fn}`,
            typeArguments: [],
            functionArguments: args,
        },
    });
}

async function submitRelayerTx(payload) {
    const tx = await aptos.transaction.build.simple({
        sender: relayerAccount.accountAddress,
        data: payload,
        options: { maxGasAmount: 2_000_000, gasUnitPrice: 100 },
    });
    const auth = await aptos.transaction.sign({ signer: relayerAccount, transaction: tx });
    const result = await aptos.transaction.submit.simple({
        senderAuthenticator: auth,
        transaction: tx,
    });
    const receipt = await aptos.waitForTransaction({ transactionHash: result.hash });
    if (!receipt.success) throw new Error(`Aptos tx failed: ${result.hash}`);
    return receipt;
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected. Mode: ${dryRun ? "DRY RUN" : "DRAIN"}`);
    console.log(`module: ${moduleAddr}`);
    console.log(`pool:   ${poolAddr}\n`);

    const [countRaw] = await viewPool("pending_commitments_count", [poolAddr]);
    const pendingCount = Number(countRaw);
    console.log(`pending_commitments_count = ${pendingCount}`);

    if (pendingCount === 0) {
        console.log("\nNothing pending — the pool is not blocked.");
        await mongoose.disconnect();
        return;
    }

    // Pending commitments, in on-chain queue order (update_root asserts
    // first_pending == commitment, so order matters).
    const ordered = [];
    for (let i = 0; i < pendingCount; i++) {
        const [c] = await viewPool("get_pending_commitment_at", [poolAddr, String(i)]);
        ordered.push(String(c));
        console.log(`  pending[${i}] = ${c}`);
    }

    // Rebuild the in-memory tree + subtree mirror from the DB.
    await initializeAptosPool(POOL_ID);
    const state = aptosPoolStates[POOL_ID];

    // The mirror must match the contract before generating proofs, or every
    // proof is doomed.
    const [chainHash] = await viewPool("current_subtrees_hash", [poolAddr, POOL_ID]);
    const [chainNextIdx] = await viewPool("next_index", [poolAddr, POOL_ID]);
    const localHash = await subtreesHash(state.subtrees);

    console.log(`\nchain: nextIdx=${chainNextIdx} subtreesHash=${chainHash}`);
    console.log(`local: nextIdx=${state.nextIdx} subtreesHash=${localHash}`);

    if (String(chainNextIdx) !== String(state.nextIdx) || String(chainHash) !== String(localHash)) {
        throw new Error(
            "Aptos subtree mirror is out of sync with the contract. Draining now would " +
            "produce invalid proofs. Reconcile the DB against the chain first."
        );
    }
    console.log("mirror in sync ✓");

    if (dryRun) {
        console.log(`\nDRY RUN — would drain ${pendingCount} commitment(s) via update_root and record them in the DB.`);
        await mongoose.disconnect();
        return;
    }

    // Generate sequential new_root proofs from the current mirror.
    console.log("\ngenerating new_root proof(s)...");
    const { proofs, finalSubtrees, finalNextIdx } = await buildNewRootProofs(
        state.subtrees,
        state.nextIdx,
        ordered
    );

    for (const pr of proofs) {
        console.log(`  update_root for ${pr.commitment} ...`);
        const receipt = await submitRelayerTx({
            function: `${moduleAddr}::pool::update_root`,
            typeArguments: [],
            functionArguments: [
                poolAddr,
                pr.commitment,
                pr.aBytes, pr.bBytes, pr.cBytes,
                pr.newRoot,
                pr.newSubtreesHash,
            ],
        });
        console.log(`    ok  hash=${receipt.hash}  newRoot=${pr.newRoot}`);
    }

    // Inserts landed on-chain — advance the local mirror and persist to the DB.
    const entries = [];
    for (const pr of proofs) {
        state.tree.insert(BigInt(pr.commitment));
        const leafIndex = state.tree.leaves.length - 1;
        state.roots.push(pr.newRoot);
        state.latestRoot = pr.newRoot;
        state.leafToIndex[pr.commitment] = leafIndex;
        entries.push({
            commitment: pr.commitment,
            root: pr.newRoot,
            leafIndex,
            encNote: undefined,
        });
    }
    state.subtrees = finalSubtrees;
    state.nextIdx = finalNextIdx;

    const version = Number(await aptos.getLedgerInfo().then((i) => i.ledger_version)) || 0;
    await appendCommitmentsAtomic("aptos", POOL_ID, entries, state.latestRoot, version);

    const [afterCount] = await viewPool("pending_commitments_count", [poolAddr]);
    const [afterIdx] = await viewPool("next_index", [poolAddr, POOL_ID]);

    console.log(`\nafter: pending=${afterCount}  next_index=${afterIdx}  latestRoot=${state.latestRoot}`);
    console.log(
        Number(afterCount) === 0
            ? "\nPool unblocked; DB now holds the same leaves as the chain."
            : "\nWARNING: commitments are still pending."
    );

    await mongoose.disconnect();
}

// snarkjs leaves worker threads alive after proving, so node never exits on its
// own — force it, the same reason Anchor.toml passes --exit to mocha.
main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("\ndrain_aptos_pending failed:", e.message || e);
        process.exit(1);
    });
