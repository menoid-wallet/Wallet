/**
 * aptosIndexer.js
 *
 * Catch-up indexer for Aptos. Queries Move events from Aptos RPC.
 */
"use strict";

const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const { aptos, moduleAddr } = require("../config/aptosProvider");
const PoolState        = require("../models/PoolState");
const NoteState        = require("../models/NoteState");
const NullifierState   = require("../models/NullifierState");
const NoidAccountState = require("../models/NoidAccountState");

// Memory pool states for Aptos
const aptosPoolStates = {};
const aptosSpentNullifiers = new Set();
let isAptosSyncing = false;

function parseEncryptedNote(field) {
    if (!field) return "";
    if (typeof field === "string") {
        if (field.startsWith("0x")) {
            return Buffer.from(field.slice(2), "hex").toString();
        }
        return field;
    }
    if (Array.isArray(field)) {
        return Buffer.from(field).toString();
    }
    return String(field);
}

async function initializeAptosPool(poolId) {
    if (aptosPoolStates[poolId]) return;

    const poseidon = await circomlibjs.buildPoseidon();
    const hash = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs)));
    const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);

    const dbPool = await PoolState.findOne({ network: "aptos", poolId });
    if (dbPool) {
        for (const commitment of dbPool.commitments) {
            tree.insert(BigInt(commitment));
        }
    }

    aptosPoolStates[poolId] = {
        tree,
        roots:       dbPool?.roots || [],
        latestRoot:  dbPool?.latestRoot || null,
        leafToIndex: dbPool?.leafToIndex ? Object.fromEntries(dbPool.leafToIndex) : {},
        encryptedNotes: dbPool?.encryptedNotes ? Object.fromEntries(dbPool.encryptedNotes) : {}
    };
}

async function catchUpAptos() {
    if (isAptosSyncing) return;
    isAptosSyncing = true;

    try {
        console.log("\n========== CATCHUP STARTED [aptos] ==========");

        // Fetch last processed version from DB
        let noteState = await NoteState.findOne({ key: "global", network: "aptos" });
        if (!noteState) {
            const deployBlock = Number(process.env.APTOS_PRIVATE_POOL_DEPLOY_BLOCK) || 0;
            noteState = await NoteState.create({
                key: "global",
                network: "aptos",
                lastProcessedBlock: deployBlock
            });
        }

        let nullifierState = await NullifierState.findOne({ key: "global", network: "aptos" });
        if (!nullifierState) {
            nullifierState = await NullifierState.create({
                key: "global",
                network: "aptos",
                nullifiers: [],
                lastProcessedBlock: noteState.lastProcessedBlock
            });
        }
        for (const n of nullifierState.nullifiers) {
            aptosSpentNullifiers.add(n);
        }

        // Fetch latest ledger version
        const ledgerInfo = await aptos.getLedgerInfo();
        const currentVersion = Number(ledgerInfo.ledger_version);
        const lastProcessed = Math.min(noteState.lastProcessedBlock, nullifierState.lastProcessedBlock);

        console.log(`[aptos] Fetching user transactions for module address from version ${lastProcessed} to ${currentVersion}...`);

        // Query transactions interacting with moduleAddr since lastProcessed
        const query = `
          query GetPoolTransactions($moduleAddr: String!, $lastVersion: bigint!) {
            user_transactions(
              where: {
                entry_function_contract_address: { _eq: $moduleAddr }
                version: { _gt: $lastVersion }
              }
              order_by: { version: asc }
            ) {
              version
            }
          }
        `;
        const response = await aptos.queryIndexer({
            query: {
                query,
                variables: {
                    moduleAddr,
                    lastVersion: lastProcessed
                }
            }
        });
        const userTxs = response?.user_transactions || [];
        console.log(`[aptos] Found ${userTxs.length} candidate transactions to inspect.`);

        for (const utx of userTxs) {
            const version = Number(utx.version);
            const tx = await aptos.getTransactionByVersion({ ledgerVersion: version });
            if (!tx.success || !tx.events) continue;

            for (const event of tx.events) {
                const parsed = event.data;
                const type = event.type;
                if (!parsed) continue;

                // Handle NoteCreatedEvent
                if (type === `${moduleAddr}::pool::NoteCreatedEvent`) {
                    const poolId = parsed.pool_id.toString();
                    const commitment = parsed.commitment.toString();
                    const encryptedNote = parseEncryptedNote(parsed.encrypted_note);

                    await initializeAptosPool(poolId);
                    const state = aptosPoolStates[poolId];

                    if (!state.leafToIndex[commitment]) {
                        state.tree.insert(BigInt(commitment));
                        const leafIndex = state.tree.leaves.length - 1;
                        const root = state.tree.root.toString();

                        state.roots.push(root);
                        state.latestRoot = root;
                        state.leafToIndex[commitment] = leafIndex;
                        state.encryptedNotes[commitment] = encryptedNote;

                        // Update DB
                        let dbPool = await PoolState.findOne({ network: "aptos", poolId });
                        if (!dbPool) {
                            dbPool = new PoolState({
                                network: "aptos",
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
                        dbPool.lastProcessedBlock = version;
                        await dbPool.save();

                        console.log(`[aptos] Commitment synced: ${commitment} in pool ${poolId}`);
                    }
                }

                // Handle NullifierSpentEvent
                if (type === `${moduleAddr}::pool::NullifierSpentEvent`) {
                    const nullifier = parsed.nullifier.toString();
                    if (!aptosSpentNullifiers.has(nullifier)) {
                        aptosSpentNullifiers.add(nullifier);
                        nullifierState.nullifiers.push(nullifier);
                        console.log(`[aptos] Nullifier spent: ${nullifier}`);
                    }
                }
            }
        }

        // Update global note and nullifier states to the latest ledger version checked
        noteState.lastProcessedBlock = currentVersion;
        nullifierState.lastProcessedBlock = currentVersion;
        await noteState.save();
        await nullifierState.save();

        console.log("========== CATCHUP COMPLETE [aptos] ==========");
    } catch (err) {
        console.error("[aptos] Catchup failed:", err);
    } finally {
        isAptosSyncing = false;
    }
}

module.exports = {
    catchUpAptos,
    aptosPoolStates,
    aptosSpentNullifiers,
    initializeAptosPool
};
