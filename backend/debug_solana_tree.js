/**
 * debug_solana_tree.js
 *
 * Standalone debug script — no server needed.
 *
 * What it does:
 *  1. Fetches every confirmed transaction for the Noid Solana program.
 *  2. Parses NoteCreatedEvent + NullifierSpentEvent from logs IN SLOT ORDER.
 *  3. Rebuilds the Merkle tree leaf-by-leaf, recording the root after each insert.
 *  4. Loads the DB's commitments array and does the same.
 *  5. Prints a side-by-side diff — the first diverging row is your bug.
 *  6. Prints which indices are missing from leafToIndex and which are out-of-order.
 *
 * Usage:
 *   node debug_solana_tree.js
 *
 * Requires the same .env as the main server.
 */

"use strict";

require("dotenv").config();

const { Connection, PublicKey, Keypair } = require("@solana/web3.js");
const { Program, AnchorProvider, Wallet } = require("@coral-xyz/anchor");
const { EventParser }           = require("@coral-xyz/anchor");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const circomlibjs               = require("circomlibjs");
const mongoose                  = require("mongoose");
const fs                        = require("fs");
const path                      = require("path");

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL        = process.env.SOLANA_RPC_URL    || "https://api.devnet.solana.com";
const PROGRAM_ID_STR = process.env.SOLANA_PROGRAM_ID || "3wxDTqw42qqftiAcTZ6kLeNtepuSmB1mR1skrEcwD9SC";
const MONGO_URI      = process.env.MONGO_URI;

// Delay between every individual getTransaction call (ms).
// 400 ms ≈ 2.5 req/s — well inside the free devnet limit of ~10 req/s.
// Increase to 1000 if you still hit 429s.
const TX_FETCH_DELAY_MS = 400;

// Delay between signature-list pages (ms)
const SIG_PAGE_DELAY_MS = 600;

if (!MONGO_URI) { console.error("❌  MONGO_URI not set in .env"); process.exit(1); }

// ─── Rate-limited fetch helpers ───────────────────────────────────────────────

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch a single transaction with linear retry on 429.
 * Waits TX_FETCH_DELAY_MS before every call so we never burst.
 */
async function fetchTxWithRetry(connection, signature, maxRetries = 6) {
    let delay = TX_FETCH_DELAY_MS;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await sleep(delay);
        try {
            const tx = await connection.getTransaction(signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0
            });
            return tx;
        } catch (err) {
            const is429 = err?.message?.includes("429") || err?.message?.includes("Too Many");
            if (is429 && attempt < maxRetries) {
                delay = Math.min(delay * 2, 16_000); // cap at 16 s
                console.log(`  ⏳  429 on tx fetch — waiting ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
            } else if (attempt === maxRetries) {
                console.warn(`  ⚠️  Failed after ${maxRetries} retries for ${signature.slice(0,20)}…: ${err.message}`);
                return null;
            }
        }
    }
    return null;
}

/**
 * Fetch one page of signatures with retry on 429.
 */
async function fetchSigsWithRetry(connection, programId, opts, maxRetries = 6) {
    let delay = SIG_PAGE_DELAY_MS;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await sleep(delay);
        try {
            return await connection.getSignaturesForAddress(programId, opts);
        } catch (err) {
            const is429 = err?.message?.includes("429") || err?.message?.includes("Too Many");
            if (is429 && attempt < maxRetries) {
                delay = Math.min(delay * 2, 16_000);
                console.log(`  ⏳  429 on sig fetch — waiting ${delay}ms`);
            } else {
                throw err;
            }
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytesToDecimal(bytes) {
    let result = 0n;
    for (const b of bytes) result = (result << 8n) + BigInt(b);
    return result.toString();
}

function shortCmx(s) {
    if (!s || s === "(MISSING)") return s;
    return s.slice(0, 12) + "…" + s.slice(-6);
}

// ─── Mongoose PoolState model (inline) ───────────────────────────────────────

const poolStateSchema = new mongoose.Schema({
    network:            String,
    poolId:             String,
    commitments:        [String],
    encryptedNotes:     { type: Map, of: String, default: {} },
    roots:              [String],
    latestRoot:         String,
    leafToIndex:        { type: Map, of: Number, default: {} },
    lastProcessedBlock: Number
});
const PoolState = mongoose.model("PoolState", poolStateSchema);

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    // 1. MongoDB
    console.log("Connecting to MongoDB…");
    await mongoose.connect(MONGO_URI);
    console.log("✅  MongoDB connected\n");

    const dbPool = await PoolState.findOne({ network: "solana", poolId: "0" });
    if (!dbPool) {
        console.error("❌  No PoolState for network=solana poolId=0");
        process.exit(1);
    }

    const dbCommitments = dbPool.commitments;
    const dbLeafToIndex = Object.fromEntries(dbPool.leafToIndex);
    const dbRoots       = dbPool.roots;

    console.log(`DB: ${dbCommitments.length} commitments, ${dbRoots.length} roots`);
    console.log(`DB latestRoot: ${dbPool.latestRoot?.slice(0, 24)}…\n`);

    // 2. Solana connection
    console.log("Connecting to Solana RPC:", RPC_URL);
    const connection   = new Connection(RPC_URL, "confirmed");
    const dummyWallet  = new Wallet(Keypair.generate());
    const provider     = new AnchorProvider(connection, dummyWallet, { commitment: "confirmed" });

    // Load IDL
    const idlCandidates = [
        path.resolve(__dirname, "./src/abis/solana/noid_solana.json"),
        path.resolve(__dirname, "abis/solana/noid_solana.json"),
        path.resolve(__dirname, "../abis/solana/noid_solana.json"),
    ];
    let idl = null;
    for (const p of idlCandidates) {
        if (fs.existsSync(p)) { idl = JSON.parse(fs.readFileSync(p, "utf8")); break; }
    }
    if (!idl) {
        console.error("❌  Cannot find noid_solana.json IDL.");
        process.exit(1);
    }

    const programId = new PublicKey(PROGRAM_ID_STR);

    // Ensure IDL address matches our program — required for EventParser log matching
    idl.address = PROGRAM_ID_STR;

    // Pass programId explicitly — required in @coral-xyz/anchor >= 0.29
    let program;
    try {
        program = new Program(idl, programId, provider);
    } catch (_) {
        // Older anchor versions take (idl, provider)
        program = new Program(idl, provider);
    }
    const parser = new EventParser(programId, program.coder);

    // 3. Fetch all signatures (paginated, rate-limited)
    console.log("Fetching all program signatures (rate-limited)…");
    const allSigs = [];
    let before = undefined;
    let page    = 0;
    while (true) {
        const batch = await fetchSigsWithRetry(connection, programId, { limit: 100, before });
        if (!batch || !batch.length) break;
        allSigs.push(...batch);
        before = batch[batch.length - 1].signature;
        page++;
        process.stdout.write(`  page ${page}: ${allSigs.length} sigs so far…\r`);
        if (batch.length < 100) break;
    }
    console.log(`\n✅  Total signatures: ${allSigs.length}`);

    // Sort oldest → newest by slot, then blockTime for same-slot ties
    const validSigs = allSigs
        .filter(s => !s.err)
        .sort((a, b) => (a.slot - b.slot) || ((a.blockTime ?? 0) - (b.blockTime ?? 0)));

    console.log(`  ${validSigs.length} successful txns, sorted oldest-first\n`);

    // 4. Parse events — one tx at a time with delay
    console.log(`Fetching & parsing ${validSigs.length} transactions (${TX_FETCH_DELAY_MS}ms gap each)…`);
    const onChainCommitments = [];
    const onChainNullifiers  = [];

    for (let i = 0; i < validSigs.length; i++) {
        const sigInfo = validSigs[i];
        process.stdout.write(`  [${i + 1}/${validSigs.length}] slot=${sigInfo.slot} …\r`);

        const tx = await fetchTxWithRetry(connection, sigInfo.signature);
        if (!tx?.meta?.logMessages) continue;

        // Dump raw logs for the first transaction so we can see what we're working with
        if (i === 0) {
            console.log("\n--- RAW LOGS for first tx (slot " + sigInfo.slot + ") ---");
            for (const line of tx.meta.logMessages) console.log("  ", line);
            console.log("--- END RAW LOGS ---\n");
        }

        // Try Anchor EventParser first
        let anchorEvents = [];
        try {
            anchorEvents = [...parser.parseLogs(tx.meta.logMessages)];
        } catch (_) {}

        // Fallback: manually decode "Program data: <base64>" lines
        // Anchor emits events as base64-encoded borsh under that prefix.
        // We decode them ourselves if EventParser found nothing.
        const manualEvents = [];
        if (anchorEvents.length === 0) {
            for (const line of tx.meta.logMessages) {
                const match = line.match(/^Program data: (.+)$/);
                if (!match) continue;
                try {
                    const raw = Buffer.from(match[1], "base64");
                    // Anchor event discriminator = first 8 bytes
                    // NoteCreatedEvent discriminator from IDL events array
                    const NOTE_DISC   = Buffer.from([69, 208, 51, 69, 84, 102, 229, 9]);
                    const NULL_DISC   = Buffer.from([93, 68, 83, 76, 247, 54, 247, 49]);
                    const disc = raw.slice(0, 8);
                    if (disc.equals(NOTE_DISC)) {
                        // pool_id: u64 (8 bytes LE) + commitment: [u8;32]
                        const poolId     = raw.readBigUInt64LE(8).toString();
                        const commitment = bytesToDecimal(raw.slice(16, 48));
                        manualEvents.push({ name: "NoteCreatedEvent", data: { poolId, commitment } });
                    } else if (disc.equals(NULL_DISC)) {
                        // nullifier: [u8;32]
                        const nullifier = bytesToDecimal(raw.slice(8, 40));
                        manualEvents.push({ name: "NullifierSpentEvent", data: { nullifier } });
                    }
                } catch (_) {}
            }
        }

        const events = anchorEvents.length > 0 ? anchorEvents : manualEvents;

        if (i === 0 && events.length === 0) {
            console.log("⚠️  First tx produced 0 events from both Anchor parser and manual decoder.");
            console.log("    Check the raw logs above — the discriminators may differ from IDL.");
        }

        for (const ev of events) {
            if (ev.name === "NoteCreatedEvent") {
                // commitment may be raw bytes array OR already a decimal string (manual path)
                const cmx = Array.isArray(ev.data.commitment)
                    ? bytesToDecimal(ev.data.commitment)
                    : ev.data.commitment.toString();
                onChainCommitments.push({
                    slot:       sigInfo.slot,
                    txSig:      sigInfo.signature,
                    commitment: cmx
                });
            } else if (ev.name === "NullifierSpentEvent") {
                const nul = Array.isArray(ev.data.nullifier)
                    ? bytesToDecimal(ev.data.nullifier)
                    : ev.data.nullifier.toString();
                onChainNullifiers.push({
                    slot:      sigInfo.slot,
                    txSig:     sigInfo.signature,
                    nullifier: nul
                });
            }
        }
    }

    console.log(`\n✅  On-chain commitments: ${onChainCommitments.length}`);
    console.log(`✅  On-chain nullifiers:  ${onChainNullifiers.length}\n`);

    // 5. Build correct tree from on-chain order
    console.log("Building correct Merkle tree (on-chain order)…");
    const poseidon = await circomlibjs.buildPoseidon();
    const hashFn   = (inputs) => BigInt(poseidon.F.toString(poseidon(inputs)));

    const correctTree        = new IncrementalMerkleTree(hashFn, 20, BigInt(0), 2);
    const correctRoots       = [];
    const correctLeafToIndex = {};

    for (const { commitment } of onChainCommitments) {
        correctTree.insert(BigInt(commitment));
        const idx  = correctTree.leaves.length - 1;
        correctRoots.push(correctTree.root.toString());
        correctLeafToIndex[commitment] = idx;
    }

    // 6. Build DB tree from DB commitments[] order
    console.log("Building DB Merkle tree (db.commitments[] order)…\n");
    const dbTree            = new IncrementalMerkleTree(hashFn, 20, BigInt(0), 2);
    const dbRecomputedRoots = [];

    for (const c of dbCommitments) {
        dbTree.insert(BigInt(c));
        dbRecomputedRoots.push(dbTree.root.toString());
    }

    // ── 7. Side-by-side diff ──────────────────────────────────────────────────
    const maxLen = Math.max(onChainCommitments.length, dbCommitments.length);

    console.log("════════════════════════════════════════════════════════════════");
    console.log("  SIDE-BY-SIDE DIFF: On-chain order vs DB commitments[] order");
    console.log("════════════════════════════════════════════════════════════════");
    console.log(
        "Idx".padEnd(5),
        "On-chain".padEnd(22),
        "DB".padEnd(22),
        "?".padEnd(4),
        "On-chain root".padEnd(26),
        "DB recomputed root"
    );
    console.log("─".repeat(110));

    let firstDivergence = null;
    for (let i = 0; i < maxLen; i++) {
        const oc     = onChainCommitments[i]?.commitment ?? "(MISSING)";
        const db     = dbCommitments[i]                  ?? "(MISSING)";
        const match  = oc === db ? "✅" : "❌";
        const ocRoot = correctRoots[i]         ? correctRoots[i].slice(0, 20) + "…"      : "(n/a)";
        const dbRoot = dbRecomputedRoots[i]    ? dbRecomputedRoots[i].slice(0, 20) + "…" : "(n/a)";

        if (oc !== db && firstDivergence === null) firstDivergence = i;

        const near = firstDivergence !== null && Math.abs(i - firstDivergence) <= 5;
        if (i < 30 || near || i >= maxLen - 5) {
            console.log(
                String(i).padEnd(5),
                shortCmx(oc).padEnd(22),
                shortCmx(db).padEnd(22),
                match.padEnd(4),
                ocRoot.padEnd(26),
                dbRoot
            );
        } else if (i === 30 && firstDivergence === null) {
            console.log("  … identical rows hidden …");
        }
    }

    console.log("\n════════════════════════════════════════════════════════════════");
    if (firstDivergence === null) {
        console.log("✅  DB commitments[] order matches on-chain order EXACTLY.");
    } else {
        console.log(`❌  First divergence at index ${firstDivergence}`);
        console.log(`    On-chain: ${onChainCommitments[firstDivergence]?.commitment}`);
        console.log(`    In DB:    ${dbCommitments[firstDivergence]}`);
        console.log(`    Tx slot:  ${onChainCommitments[firstDivergence]?.slot}`);
        console.log(`    Tx sig:   ${onChainCommitments[firstDivergence]?.txSig}`);
    }

    // ── 8. leafToIndex audit ──────────────────────────────────────────────────
    console.log("\n════════════════════════════════════════════════════════════════");
    console.log("  leafToIndex AUDIT (DB map vs correct on-chain index)");
    console.log("════════════════════════════════════════════════════════════════");

    const allCmx = new Set([
        ...onChainCommitments.map(x => x.commitment),
        ...Object.keys(dbLeafToIndex)
    ]);

    let leafErrors = 0;
    for (const cmx of allCmx) {
        const cIdx = correctLeafToIndex[cmx];
        const dIdx = dbLeafToIndex[cmx];
        if (cIdx === undefined) {
            console.log(`  ⚠️  ${shortCmx(cmx)} → in DB (idx=${dIdx}) but NOT on-chain`);
            leafErrors++;
        } else if (dIdx === undefined) {
            console.log(`  ❌  ${shortCmx(cmx)} → on-chain idx=${cIdx} MISSING from DB leafToIndex`);
            leafErrors++;
        } else if (dIdx !== cIdx) {
            console.log(`  ❌  ${shortCmx(cmx)} → on-chain=${cIdx}, DB=${dIdx}  (WRONG)`);
            leafErrors++;
        }
    }
    if (leafErrors === 0) console.log("  ✅  All leafToIndex entries correct.");
    else console.log(`\n  Total leafToIndex errors: ${leafErrors}`);

    // Missing indices
    const dbIdxSet  = new Set(Object.values(dbLeafToIndex));
    const missingIdx = [];
    for (let i = 0; i < onChainCommitments.length; i++) {
        if (!dbIdxSet.has(i)) missingIdx.push(i);
    }
    if (missingIdx.length) console.log(`\n  ❌  Indices missing from leafToIndex: ${missingIdx.join(", ")}`);
    else                   console.log(`\n  ✅  No missing indices.`);

    // ── 9. Root comparison ────────────────────────────────────────────────────
    console.log("\n════════════════════════════════════════════════════════════════");
    console.log("  ROOT COMPARISON (stored db.roots[] vs correct recomputed)");
    console.log("════════════════════════════════════════════════════════════════");

    let rootErrors = 0;
    for (let i = 0; i < Math.max(dbRoots.length, correctRoots.length); i++) {
        const stored  = dbRoots[i]      ?? "(missing)";
        const correct = correctRoots[i] ?? "(missing)";
        if (stored !== correct) {
            rootErrors++;
            if (rootErrors <= 10)
                console.log(`  ❌  roots[${i}]: stored=${stored.slice(0,20)}… correct=${correct.slice(0,20)}…`);
        }
    }
    if (rootErrors === 0) console.log("  ✅  All stored roots correct.");
    else                  console.log(`\n  Total root mismatches: ${rootErrors}`);

    // ── 10. Final root ────────────────────────────────────────────────────────
    const correctFinal = correctRoots[correctRoots.length - 1] ?? null;
    console.log("\n════════════════════════════════════════════════════════════════");
    console.log("  FINAL ROOT");
    console.log(`  DB latestRoot:     ${dbPool.latestRoot}`);
    console.log(`  Correct finalRoot: ${correctFinal}`);
    console.log(`  Match: ${dbPool.latestRoot === correctFinal ? "✅" : "❌"}`);

    // ── 11. Write repair data ─────────────────────────────────────────────────
    if (firstDivergence !== null || leafErrors > 0) {
        const repairData = {
            commitments: onChainCommitments.map(x => x.commitment),
            roots:       correctRoots,
            leafToIndex: correctLeafToIndex,
            latestRoot:  correctFinal
        };
        const repairPath = path.join(__dirname, "repair_data.json");
        fs.writeFileSync(repairPath, JSON.stringify(repairData, null, 2));
        console.log("\n════════════════════════════════════════════════════════════════");
        console.log("  REPAIR DATA written to repair_data.json");
        console.log("  Run:  node repair_solana_db.js --dry-run");
        console.log("  Then: node repair_solana_db.js");
    }

    console.log("\nDone.\n");
    await mongoose.disconnect();
}

main().catch(err => {
    console.error("Fatal:", err);
    mongoose.disconnect().finally(() => process.exit(1));
});