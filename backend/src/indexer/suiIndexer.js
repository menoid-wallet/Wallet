/**
 * suiIndexer.js
 *
 * Catch-up indexer for Sui. Queries Move events from Sui RPC.
 */
"use strict";

const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const { suiClient, packageId, poolStateId } = require("../config/suiProvider");
const PoolState        = require("../models/PoolState");
const NoteState        = require("../models/NoteState");
const NullifierState   = require("../models/NullifierState");
const NoidAccountState = require("../models/NoidAccountState");

// Memory pool states for Sui
const suiPoolStates = {};
const suiSpentNullifiers = new Set();
let isSuiSyncing = false;

async function initializeSuiPool(poolId) {
    if (suiPoolStates[poolId]) return;

    const poseidon = await circomlibjs.buildPoseidon();
    const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs)));
    const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);

    const dbPool = await PoolState.findOne({ network: "sui", poolId });
    if (dbPool) {
        for (const commitment of dbPool.commitments) {
            tree.insert(BigInt(commitment));
        }
    }

    suiPoolStates[poolId] = {
        tree,
        roots:       dbPool?.roots || [],
        latestRoot:  dbPool?.latestRoot || null,
        leafToIndex: dbPool?.leafToIndex ? Object.fromEntries(dbPool.leafToIndex) : {},
        encryptedNotes: dbPool?.encryptedNotes ? Object.fromEntries(dbPool.encryptedNotes) : {}
    };
}

async function catchUpSui() {
    if (isSuiSyncing) return;
    isSuiSyncing = true;

    try {
        console.log("\n========== CATCHUP STARTED [sui] ==========");

        // Fetch last processed sequence number or time from DB
        let noteState = await NoteState.findOne({ key: "global", network: "sui" });
        if (!noteState) {
            const deployBlock = Number(process.env.SUI_PRIVATE_POOL_DEPLOY_BLOCK) || 0;
            noteState = await NoteState.create({
                key: "global",
                network: "sui",
                lastProcessedBlock: deployBlock
            });
        }

        let nullifierState = await NullifierState.findOne({ key: "global", network: "sui" });
        if (!nullifierState) {
            nullifierState = await NullifierState.create({
                key: "global",
                network: "sui",
                nullifiers: [],
                lastProcessedBlock: noteState.lastProcessedBlock
            });
        }
        for (const n of nullifierState.nullifiers) {
            suiSpentNullifiers.add(n);
        }

        // We query events for Sui
        // NoteCreatedEvents
        const noteEvents = await suiClient.queryEvents({
            query: { MoveEventType: `${packageId}::pool::NoteCreatedEvent` },
            limit: 100
        });

        for (const event of noteEvents.data) {
            const parsed = event.parsedJson;
            if (!parsed) continue;

            const poolId = parsed.pool_id.toString();
            const commitment = parsed.commitment.toString();
            const encryptedNote = parsed.encrypted_note 
                ? Buffer.from(parsed.encrypted_note).toString()
                : "";

            await initializeSuiPool(poolId);
            const state = suiPoolStates[poolId];

            if (!state.leafToIndex[commitment]) {
                state.tree.insert(BigInt(commitment));
                const leafIndex = state.tree.leaves.length - 1;
                const root = state.tree.root.toString();

                state.roots.push(root);
                state.latestRoot = root;
                state.leafToIndex[commitment] = leafIndex;
                state.encryptedNotes[commitment] = encryptedNote;

                // Update DB
                let dbPool = await PoolState.findOne({ network: "sui", poolId });
                if (!dbPool) {
                    dbPool = new PoolState({
                        network: "sui",
                        poolId,
                        commitments: [],
                        roots: [],
                        latestRoot: null,
                        leafToIndex: {},
                        encryptedNotes: {}
                    });
                }
                dbPool.commitments.push(commitment);
                dbPool.roots.push(root);
                dbPool.latestRoot = root;
                dbPool.leafToIndex.set(commitment, leafIndex);
                dbPool.encryptedNotes.set(commitment, encryptedNote);
                dbPool.lastProcessedBlock = Number(event.id.txDigest) || 0; // fallback representation
                await dbPool.save();

                console.log(`[sui] Commitment synced: ${commitment} in pool ${poolId}`);
            }
        }

        // NullifierSpentEvents
        const nullifierEvents = await suiClient.queryEvents({
            query: { MoveEventType: `${packageId}::pool::NullifierSpentEvent` },
            limit: 100
        });

        for (const event of nullifierEvents.data) {
            const parsed = event.parsedJson;
            if (!parsed) continue;

            const nullifier = parsed.nullifier.toString();
            if (!suiSpentNullifiers.has(nullifier)) {
                suiSpentNullifiers.add(nullifier);
                nullifierState.nullifiers.push(nullifier);
                console.log(`[sui] Nullifier spent: ${nullifier}`);
            }
        }

        await nullifierState.save();

        console.log("========== CATCHUP COMPLETE [sui] ==========");
    } catch (err) {
        console.error("[sui] Catchup failed:", err);
    } finally {
        isSuiSyncing = false;
    }
}

module.exports = {
    catchUpSui,
    suiPoolStates,
    suiSpentNullifiers,
    initializeSuiPool
};
