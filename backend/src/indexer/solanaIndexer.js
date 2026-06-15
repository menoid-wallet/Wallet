/**
 * solanaIndexer.js
 *
 * Catch-up indexer for Solana. Parses transaction logs for program events.
 */
"use strict";

const { EventParser } = require("@coral-xyz/anchor");
const { PublicKey } = require("@solana/web3.js");
const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const { connection, program, programId, poolStatePda } = require("../config/solanaProvider");
const PoolState        = require("../models/PoolState");
const NoteState        = require("../models/NoteState");
const NullifierState   = require("../models/NullifierState");
const NoidAccountState = require("../models/NoidAccountState");

// Memory pool states for Solana
const solanaPoolStates = {};
const solanaSpentNullifiers = new Set();
let isSolanaSyncing = false;

function bytesToDecimal(bytes) {
    let result = 0n;
    for (const b of bytes) {
        result = (result << 8n) + BigInt(b);
    }
    return result.toString();
}

async function initializeSolanaPool(poolId) {
    if (solanaPoolStates[poolId]) return;

    const poseidon = await circomlibjs.buildPoseidon();
    const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs)));
    const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);

    const dbPool = await PoolState.findOne({ network: "solana", poolId });
    if (dbPool) {
        for (const commitment of dbPool.commitments) {
            tree.insert(BigInt(commitment));
        }
    }

    solanaPoolStates[poolId] = {
        tree,
        roots:       dbPool?.roots || [],
        latestRoot:  dbPool?.latestRoot || null,
        leafToIndex: dbPool?.leafToIndex ? Object.fromEntries(dbPool.leafToIndex) : {},
        encryptedNotes: dbPool?.encryptedNotes ? Object.fromEntries(dbPool.encryptedNotes) : {}
    };
}

async function catchUpSolana() {
    if (isSolanaSyncing) return;
    isSolanaSyncing = true;

    try {
        console.log("\n========== CATCHUP STARTED [solana] ==========");

        // Get last processed slot/block from DB
        let noteState = await NoteState.findOne({ key: "global", network: "solana" });
        if (!noteState) {
            // Default deploy block (slot) for our program
            const deployBlock = Number(process.env.SOLANA_PRIVATE_POOL_DEPLOY_BLOCK) || 0;
            noteState = await NoteState.create({
                key: "global",
                network: "solana",
                lastProcessedBlock: deployBlock
            });
        }

        let nullifierState = await NullifierState.findOne({ key: "global", network: "solana" });
        if (!nullifierState) {
            nullifierState = await NullifierState.create({
                key: "global",
                network: "solana",
                nullifiers: [],
                lastProcessedBlock: noteState.lastProcessedBlock
            });
        }
        for (const n of nullifierState.nullifiers) {
            solanaSpentNullifiers.add(n);
        }

        const latestSlot = await connection.getSlot("confirmed");
        const lastSlot = Number(noteState.lastProcessedBlock);

        console.log(`[solana] Current DB slot: ${lastSlot} | Latest on-chain slot: ${latestSlot}`);

        if (latestSlot > lastSlot) {
            // Fetch signatures for the program to parse logs
            const signatures = await connection.getSignaturesForAddress(programId, {
                until: lastSlot > 0 ? undefined : undefined, // Anchor signatures fetch
                limit: 1000
            });

            // Filter signatures that are finalized/confirmed and happened after the lastSlot
            const validSigs = signatures
                .filter(s => s.slot > lastSlot && !s.err)
                .sort((a, b) => a.slot - b.slot);

            if (validSigs.length > 0) {
                console.log(`[solana] Parsing events for ${validSigs.length} signatures...`);
                const eventParser = new EventParser(programId, program.coder);

                for (const sigInfo of validSigs) {
                    const tx = await connection.getTransaction(sigInfo.signature, {
                        commitment: "confirmed",
                        maxSupportedTransactionVersion: 0
                    });

                    if (!tx || !tx.meta || !tx.meta.logMessages) continue;

                    const events = eventParser.parseLogs(tx.meta.logMessages);
                    for (const event of events) {
                        if (event.name === "NoteCreatedEvent") {
                            const poolId = event.data.poolId.toString();
                            const commitment = bytesToDecimal(event.data.commitment);

                            await initializeSolanaPool(poolId);
                            const state = solanaPoolStates[poolId];

                            // Check if already in memory/DB
                            if (!state.leafToIndex[commitment]) {
                                state.tree.insert(BigInt(commitment));
                                const leafIndex = state.tree.leaves.length - 1;
                                const root = state.tree.root.toString();

                                state.roots.push(root);
                                state.latestRoot = root;
                                state.leafToIndex[commitment] = leafIndex;

                                // Note: encrypted note is not on Solana events, we store it as null or empty string
                                state.encryptedNotes[commitment] = "";

                                // Update DB
                                let dbPool = await PoolState.findOne({ network: "solana", poolId });
                                if (!dbPool) {
                                    dbPool = new PoolState({
                                        network: "solana",
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
                                dbPool.encryptedNotes.set(commitment, "");
                                dbPool.lastProcessedBlock = sigInfo.slot;
                                await dbPool.save();

                                console.log(`[solana] Commitment synced: ${commitment} in pool ${poolId}`);
                            }
                        } else if (event.name === "NullifierSpentEvent") {
                            const nullifier = bytesToDecimal(event.data.nullifier);
                            if (!solanaSpentNullifiers.has(nullifier)) {
                                solanaSpentNullifiers.add(nullifier);
                                nullifierState.nullifiers.push(nullifier);
                                console.log(`[solana] Nullifier spent: ${nullifier}`);
                            }
                        }
                    }
                }
            }

            // Update processed slots
            noteState.lastProcessedBlock = latestSlot;
            await noteState.save();

            nullifierState.lastProcessedBlock = latestSlot;
            await nullifierState.save();
        }

        console.log("========== CATCHUP COMPLETE [solana] ==========");
    } catch (err) {
        console.error("[solana] Catchup failed:", err);
    } finally {
        isSolanaSyncing = false;
    }
}

module.exports = {
    catchUpSolana,
    solanaPoolStates,
    solanaSpentNullifiers,
    initializeSolanaPool
};
