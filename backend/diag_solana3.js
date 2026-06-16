"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const { EventParser } = require("@coral-xyz/anchor");
const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");
const { connection, program, programId } = require("./src/config/solanaProvider");

function bytesToDecimal(bytes) {
  let r = 0n; for (const b of bytes) r = (r << 8n) + BigInt(b); return r.toString();
}

(async () => {
  console.log("Fetching ALL program signatures (chronological)…");
  // page back to the beginning
  let all = [];
  let before = undefined;
  while (true) {
    const sigs = await connection.getSignaturesForAddress(programId, { limit: 1000, before });
    if (!sigs.length) break;
    all = all.concat(sigs);
    before = sigs[sigs.length - 1].signature;
    if (sigs.length < 1000) break;
  }
  const valid = all.filter(s => !s.err).sort((a, b) => (a.slot - b.slot) || (a.blockTime - b.blockTime));
  console.log("total signatures:", all.length, "valid:", valid.length);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const parser = new EventParser(programId, program.coder);
  const orderedCommitments = [];
  const nullifiers = [];
  for (const s of valid) {
    await sleep(700);
    const tx = await connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta || !tx.meta.logMessages) continue;
    for (const ev of parser.parseLogs(tx.meta.logMessages)) {
      if (ev.name === "NoteCreatedEvent") orderedCommitments.push(bytesToDecimal(ev.data.commitment));
      else if (ev.name === "NullifierSpentEvent") nullifiers.push(bytesToDecimal(ev.data.nullifier));
    }
  }
  console.log("on-chain NoteCreated count:", orderedCommitments.length);
  console.log("on-chain Nullifier count:", nullifiers.length);

  const poseidon = await circomlibjs.buildPoseidon();
  const hash = (inp) => BigInt(poseidon.F.toString(poseidon(inp)));
  const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);
  const roots = [];
  for (const c of orderedCommitments) { tree.insert(BigInt(c)); roots.push(tree.root.toString()); }
  const finalRoot = orderedCommitments.length ? tree.root.toString() : null;
  console.log("\nrebuilt-from-chain final root:", finalRoot);
  console.log("on-chain current_root        : 615204248760507506267547476843127933195519785745060836854001864579071749348");
  console.log("MATCH?", finalRoot === "615204248760507506267547476843127933195519785745060836854001864579071749348");

  // compare against DB
  await mongoose.connect(process.env.MONGO_URI);
  const PoolState = require("./src/models/PoolState");
  const dbPool = await PoolState.findOne({ network: "solana", poolId: "0" });
  console.log("\nDB commitments:", dbPool.commitments.length, "| chain commitments:", orderedCommitments.length);
  const dbSet = new Set(dbPool.commitments);
  const chainSet = new Set(orderedCommitments);
  console.log("in chain but NOT in DB:", orderedCommitments.filter(c => !dbSet.has(c)).map(c=>c.slice(0,14)));
  console.log("in DB but NOT on chain:", dbPool.commitments.filter(c => !chainSet.has(c)).map(c=>c.slice(0,14)));
  // order diff
  console.log("\nfirst index where DB order != chain order:");
  for (let i = 0; i < Math.max(dbPool.commitments.length, orderedCommitments.length); i++) {
    if (dbPool.commitments[i] !== orderedCommitments[i]) {
      console.log(`  idx ${i}: DB=${(dbPool.commitments[i]||"").slice(0,14)} chain=${(orderedCommitments[i]||"").slice(0,14)}`);
      if (i > 12) break;
    }
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
