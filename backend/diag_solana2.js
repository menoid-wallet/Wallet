"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const PoolState = require("./src/models/PoolState");
  const dbPool = await PoolState.findOne({ network: "solana", poolId: "0" });
  const commitments = dbPool.commitments;
  const dbRoots = dbPool.roots;
  const leafToIndex = Object.fromEntries(dbPool.leafToIndex);
  const encNotes = Object.fromEntries(dbPool.encryptedNotes);

  const poseidon = await circomlibjs.buildPoseidon();
  const hash = (inp) => BigInt(poseidon.F.toString(poseidon(inp)));
  const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);

  console.log("idx | rebuiltRoot==dbRoot | leafToIndex | encNote? | commitment(short)");
  for (let i = 0; i < commitments.length; i++) {
    const c = commitments[i];
    tree.insert(BigInt(c));
    const rebuilt = tree.root.toString();
    const match = rebuilt === dbRoots[i];
    console.log(
      `${String(i).padStart(3)} | ${match ? "OK " : "XX "} | l2i=${String(leafToIndex[c]).padStart(3)} | ${encNotes[c] ? "yes" : "NO "} | ${c.slice(0, 18)}...`
    );
  }

  // Try to find a permutation: does sorting commitments by leafToIndex fix it?
  console.log("\n=== Rebuild using leafToIndex ordering ===");
  const byLeaf = [...commitments].sort((a, b) => (leafToIndex[a] ?? 0) - (leafToIndex[b] ?? 0));
  const tree2 = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);
  let allOk = true;
  for (let i = 0; i < byLeaf.length; i++) {
    tree2.insert(BigInt(byLeaf[i]));
    if (tree2.root.toString() !== dbRoots[i]) allOk = false;
  }
  console.log("final root (by leafToIndex):", tree2.root.toString());
  console.log("matches on-chain current_root (615204...349348)?",
    tree2.root.toString() === "615204248760507506267547476843127933195519785745060836854001864579071749348");
  console.log("all intermediate roots match dbRoots in leaf order?", allOk);

  // Print leafToIndex map vs array index
  console.log("\n=== array index vs leafToIndex (mismatches) ===");
  for (let i = 0; i < commitments.length; i++) {
    const c = commitments[i];
    if ((leafToIndex[c] ?? i) !== i) console.log(`array[${i}] has leafToIndex ${leafToIndex[c]} -> ${c.slice(0,14)}`);
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
