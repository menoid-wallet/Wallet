"use strict";
require("dotenv").config();
const fs = require("fs");
const mongoose = require("mongoose");
const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

(async () => {
  const chain = JSON.parse(fs.readFileSync(__dirname + "/chain_solana.json"));
  const ordered = chain.commitments; // on-chain insertion order
  const poseidon = await circomlibjs.buildPoseidon();
  const hash = (inp) => BigInt(poseidon.F.toString(poseidon(inp)));
  const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);
  const roots = [];
  for (const c of ordered) { tree.insert(BigInt(c)); roots.push(tree.root.toString()); }
  const finalRoot = tree.root.toString();
  const ON_CHAIN_CURRENT = "615204248760507506267547476843127933195519785745060836854001864579071749348";
  console.log("chain commitments:", ordered.length);
  console.log("rebuilt final root:", finalRoot);
  console.log("on-chain current  :", ON_CHAIN_CURRENT);
  console.log("MATCH?", finalRoot === ON_CHAIN_CURRENT);

  await mongoose.connect(process.env.MONGO_URI);
  const PoolState = require("./src/models/PoolState");
  const dbPool = await PoolState.findOne({ network: "solana", poolId: "0" });
  const dbC = dbPool.commitments;
  const encNotes = Object.fromEntries(dbPool.encryptedNotes);

  console.log("\n=== DB vs CHAIN ===");
  console.log("idx | chain                | db                   | same | dbHasNote");
  for (let i = 0; i < Math.max(ordered.length, dbC.length); i++) {
    const ch = ordered[i] || "", db = dbC[i] || "";
    const note = encNotes[ch] !== undefined && encNotes[ch] !== "";
    console.log(`${String(i).padStart(3)} | ${ch.slice(0,18).padEnd(20)} | ${db.slice(0,18).padEnd(20)} | ${ch===db?"yes":"NO "} | chainNote=${note?"y":"n"}`);
  }

  const dbSet = new Set(dbC), chSet = new Set(ordered);
  console.log("\nin CHAIN not in DB:", ordered.filter(c=>!dbSet.has(c)).map(c=>c.slice(0,16)));
  console.log("in DB not in CHAIN:", dbC.filter(c=>!chSet.has(c)).map(c=>c.slice(0,16)));

  // do we have encrypted notes for every chain commitment?
  const missingNotes = ordered.filter(c => !encNotes[c]);
  console.log("\nchain commitments missing an encrypted note in DB:", missingNotes.length, missingNotes.map(c=>c.slice(0,16)));

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
