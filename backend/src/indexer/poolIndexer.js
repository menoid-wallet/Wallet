"use strict";

const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const { getPrivatePoolForNetwork } = require("../contracts/privatePool");

const PoolState        = require("../models/PoolState");
const NoteState        = require("../models/NoteState");
const NullifierState   = require("../models/NullifierState");
const NoidAccountState = require("../models/NoidAccountState");

require("dotenv").config();

// ─── Supported networks config ────────────────────────────────────────────────
//
// maxBlockRange: the maximum number of blocks per eth_getLogs call allowed by
// the RPC provider for this network.
//   monad       → no documented limit, 90 is safe
//   sepolia     → Ankr free tier allows large ranges, 90 is safe
//   base_sepolia → Alchemy free tier hard-caps at 10 blocks per request

const NETWORKS = [
    {
        name:                   "monad",
        deployBlock:            Number(process.env.MONAD_PRIVATE_POOL_DEPLOY_BLOCK),
        noidManagerDeployBlock: Number(process.env.MONAD_NOID_ACCOUNT_MANAGER_DEPLOY_BLOCK),
        maxBlockRange:          90
    },
    {
        name:                   "sepolia",
        deployBlock:            Number(process.env.SEPOLIA_PRIVATE_POOL_DEPLOY_BLOCK),
        noidManagerDeployBlock: Number(process.env.SEPOLIA_NOID_ACCOUNT_MANAGER_DEPLOY_BLOCK),
        maxBlockRange:          90
    },
    {
        name:                   "base_sepolia",
        deployBlock:            Number(process.env.BASE_SEPOLIA_PRIVATE_POOL_DEPLOY_BLOCK),
        noidManagerDeployBlock: Number(process.env.BASE_SEPOLIA_NOID_ACCOUNT_MANAGER_DEPLOY_BLOCK),
        maxBlockRange:          9   // Alchemy free tier: max 10 blocks → use 9 to stay safely under
    }
];

// ─── In-memory state (keyed by network name) ──────────────────────────────────

// poolStates[network][poolId] = { tree, roots, latestRoot, leafToIndex, encryptedNotes }
const poolStates = {
    monad:        {},
    sepolia:      {},
    base_sepolia: {}
};

// spentNullifiers[network] = Set<string>
const spentNullifiers = {
    monad:        new Set(),
    sepolia:      new Set(),
    base_sepolia: new Set()
};

// per-network sync lock
const isSyncing = {
    monad:        false,
    sepolia:      false,
    base_sepolia: false
};

// ─── Initialize a single pool (in-memory tree from DB) ───────────────────────

async function initializePool(network, poolId) {
    if (poolStates[network][poolId]) return;

    const poseidon = await circomlibjs.buildPoseidon();
    const hash = (inputs) =>
        BigInt(poseidon.F.toString(poseidon(inputs)));

    const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);

    const dbPool = await PoolState.findOne({ network, poolId });
    if (dbPool) {
        for (const commitment of dbPool.commitments) {
            tree.insert(BigInt(commitment));
        }
    }

    poolStates[network][poolId] = {
        tree,
        roots:          [],
        latestRoot:     null,
        leafToIndex:    {},
        encryptedNotes: {}
    };

    console.log(`Pool ${poolId} [${network}] initialized`);
}

// ─── Core sync for one network ────────────────────────────────────────────────

async function syncNetwork(networkCfg) {
    const { name: network, deployBlock, noidManagerDeployBlock, maxBlockRange } = networkCfg;

    if (isSyncing[network]) {
        console.log(`Sync already running for ${network}`);
        return;
    }
    isSyncing[network] = true;

    try {
        console.log(`\n========== SYNCING [${network}] ==========`);

        const privatePool  = getPrivatePoolForNetwork(network);
        const latestBlock  = await privatePool.runner.provider.getBlockNumber();

        console.log(`[${network}] Latest block: ${latestBlock}`);

        // ── NullifierState ──
        let nullifierState = await NullifierState.findOne({ key: "global", network });
        if (!nullifierState) {
            nullifierState = await NullifierState.create({
                key:                "global",
                network,
                nullifiers:         [],
                lastProcessedBlock: deployBlock
            });
        }

        // ── NoteState ──
        let noteState = await NoteState.findOne({ key: "global", network });
        if (!noteState) {
            noteState = await NoteState.create({
                key:                "global",
                network,
                lastProcessedBlock: deployBlock
            });
        }

        // ── NoidAccountState ──
        let noidAccountState = await NoidAccountState.findOne({ key: "global", network });
        if (!noidAccountState) {
            noidAccountState = await NoidAccountState.create({
                key:                "global",
                network,
                noidAccounts:       [],
                lastProcessedBlock: noidManagerDeployBlock
            });
        }

        // ── Nullifier events ──
        const nullifierFrom = Number(nullifierState.lastProcessedBlock) + 1;

        if (nullifierFrom > latestBlock) {
            console.log(`[${network}] Nullifiers: already at tip (${latestBlock}), skipping`);
        } else {
            const nullifierTo = Math.min(nullifierFrom + maxBlockRange - 1, latestBlock);

            console.log(`[${network}] Nullifiers blocks: ${nullifierFrom} -> ${nullifierTo}`);

            const nullifierEvents = await privatePool.queryFilter(
                privatePool.filters.NullifierSpent(),
                nullifierFrom,
                nullifierTo
            );

            for (const event of nullifierEvents) {
                const nullifier = event.args.nullifier.toString();
                if (!spentNullifiers[network].has(nullifier)) {
                    spentNullifiers[network].add(nullifier);
                    nullifierState.nullifiers.push(nullifier);
                }
            }
            nullifierState.lastProcessedBlock = nullifierTo;
            await nullifierState.save();
        }

        // ── Note events ──
        const noteFrom = Number(noteState.lastProcessedBlock) + 1;

        if (noteFrom > latestBlock) {
            console.log(`[${network}] Notes: already at tip (${latestBlock}), skipping`);
        } else {
            const noteTo = Math.min(noteFrom + maxBlockRange - 1, latestBlock);

            console.log(`[${network}] Notes blocks: ${noteFrom} -> ${noteTo}`);

            const noteEvents = await privatePool.queryFilter(
                privatePool.filters.NoteCreated(),
                noteFrom,
                noteTo
            );

            for (const event of noteEvents) {
                const poolId        = event.args.poolId.toString();
                const commitment    = event.args.commitment.toString();
                const encryptedNote = event.args.encryptedNote;

                // DB pool
                let dbPool = await PoolState.findOne({ network, poolId });
                if (!dbPool) {
                    dbPool = await PoolState.create({
                        network,
                        poolId,
                        commitments:        [],
                        roots:              [],
                        latestRoot:         null,
                        leafToIndex:        {},
                        lastProcessedBlock: noteFrom
                    });
                }

                // Memory tree
                await initializePool(network, poolId);
                const state = poolStates[network][poolId];

                state.tree.insert(BigInt(commitment));

                const leafIndex = state.tree.leaves.length - 1;
                const root      = state.tree.root.toString();

                state.roots.push(root);
                state.latestRoot                  = root;
                state.leafToIndex[commitment]     = leafIndex;
                state.encryptedNotes[commitment]  = encryptedNote;

                // DB update
                dbPool.commitments.push(commitment);
                dbPool.roots.push(root);
                dbPool.latestRoot = root;
                dbPool.leafToIndex.set(commitment, leafIndex);
                dbPool.encryptedNotes.set(commitment, encryptedNote);
                dbPool.lastProcessedBlock = event.blockNumber;
                await dbPool.save();

                console.log(`[${network}] Pool ${poolId} updated`);
            }

            noteState.lastProcessedBlock = noteTo;
            await noteState.save();
        }

        // ── NoidAccount events ──
        const noidFrom = Number(noidAccountState.lastProcessedBlock) + 1;

        if (noidFrom > latestBlock) {
            console.log(`[${network}] NoidAccounts: already at tip (${latestBlock}), skipping`);
        } else {
            const noidTo = Math.min(noidFrom + maxBlockRange - 1, latestBlock);

            console.log(`[${network}] NoidAccount blocks: ${noidFrom} -> ${noidTo}`);

            const noidAccountEvents = await privatePool.queryFilter(
                privatePool.filters.NoidAccountCreated(),
                noidFrom,
                noidTo
            );

            for (const event of noidAccountEvents) {
                const commitment    = event.args.commitment;
                const encryptedNote = event.args.encryptedNote;

                const noidAccountAddress = await privatePool.NoidAccounts(commitment);

                noidAccountState.noidAccounts.push({
                    noidAccountAddress,
                    ownerCommitment: commitment.toString(),
                    encryptedNote
                });

                console.log(`[${network}] NoidAccount synced: ${noidAccountAddress}`);
            }

            noidAccountState.lastProcessedBlock = noidTo;
            await noidAccountState.save();
        }

        console.log(`========== SYNC COMPLETE [${network}] ==========`);

    } catch (err) {
        console.error(`[${network}] Sync failed:`, err);
    } finally {
        isSyncing[network] = false;
    }
}

// ─── Catch-up for one network (blocks until fully synced) ────────────────────

async function catchUpNetwork(networkCfg) {
    const { name: network, deployBlock } = networkCfg;

    console.log(`\n========== CATCHUP STARTED [${network}] ==========`);

    while (true) {
        let noteState = await NoteState.findOne({ key: "global", network });
        if (!noteState) {
            noteState = await NoteState.create({
                key:                "global",
                network,
                lastProcessedBlock: deployBlock
            });
        }

        const privatePool  = getPrivatePoolForNetwork(network);
        const latestBlock  = await privatePool.runner.provider.getBlockNumber();
        const currentBlock = Number(noteState.lastProcessedBlock);

        console.log(`[${network}] Current: ${currentBlock} | Latest: ${latestBlock}`);

        if (latestBlock - currentBlock < 50) {
            console.log(`========== FULLY SYNCED [${network}] ==========`);
            break;
        }

        await syncNetwork(networkCfg);
    }
}

// ─── Catch-up all networks in parallel ───────────────────────────────────────

async function catchUpPools() {
    // All 3 chains catch up concurrently
    await Promise.all(NETWORKS.map((cfg) => catchUpNetwork(cfg)));
    console.log("\n========== ALL CHAINS CAUGHT UP ==========");
}

// ─── Per-network 10s sync loop (starts after its own catchup) ────────────────

async function startSyncLoopForNetwork(networkCfg) {
    while (true) {
        try {
            await Promise.race([
                syncNetwork(networkCfg),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Sync timeout")), 60000)
                )
            ]);
        } catch (err) {
            console.error(`[${networkCfg.name}] Sync loop error:`, err);
        }

        await new Promise((resolve) => setTimeout(resolve, 10000));
    }
}

// ─── Start all sync loops (called after catchUpPools resolves) ────────────────

function startSyncLoop() {
    // Each chain runs its own independent 10-second loop
    for (const cfg of NETWORKS) {
        startSyncLoopForNetwork(cfg);
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    NETWORKS,
    poolStates,
    spentNullifiers,
    isSyncing,
    syncNetwork,
    catchUpNetwork,
    catchUpPools,
    startSyncLoop
};