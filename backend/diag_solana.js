/**
 * diag_solana.js — read-only diagnostic.
 * Compares on-chain root_history with DB commitments / rebuilt tree roots.
 */
"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const { Connection, PublicKey } = require("@solana/web3.js");
const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const POOL_PDA = new PublicKey(process.env.SOLANA_POOL_STATE_PDA);

function be32ToDecimal(bytes) {
  let r = 0n;
  for (const b of bytes) r = (r << 8n) + BigInt(b);
  return r.toString();
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const PoolState = require("./src/models/PoolState");
  const dbPool = await PoolState.findOne({ network: "solana", poolId: "0" });

  const commitments = dbPool ? dbPool.commitments : [];
  const dbRoots = dbPool ? dbPool.roots : [];
  const leafToIndex = dbPool && dbPool.leafToIndex ? Object.fromEntries(dbPool.leafToIndex) : {};

  console.log("\n=== DB PoolState (solana, pool 0) ===");
  console.log("commitments.length :", commitments.length);
  console.log("roots.length       :", dbRoots.length);
  console.log("latestRoot         :", dbPool && dbPool.latestRoot);
  console.log("lastProcessedBlock :", dbPool && dbPool.lastProcessedBlock);

  // detect duplicates
  const seen = new Set(); const dups = [];
  commitments.forEach((c, i) => { if (seen.has(c)) dups.push({ i, c }); else seen.add(c); });
  console.log("duplicate commitments:", dups.length, dups.slice(0, 5));

  // Rebuild tree from DB commitments, collect every intermediate root
  const poseidon = await circomlibjs.buildPoseidon();
  const hash = (inp) => BigInt(poseidon.F.toString(poseidon(inp)));
  const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);
  const rebuiltRoots = [];
  for (const c of commitments) { tree.insert(BigInt(c)); rebuiltRoots.push(tree.root.toString()); }
  const clientCurrentRoot = commitments.length ? tree.root.toString() : null;
  console.log("\n=== Rebuilt tree from DB commitments ===");
  console.log("clientCurrentRoot  :", clientCurrentRoot);

  // On-chain root_history
  const conn = new Connection(RPC, "confirmed");
  const acc = await conn.getAccountInfo(POOL_PDA);
  if (!acc) { console.log("\nPOOL PDA NOT FOUND ON CHAIN:", POOL_PDA.toBase58()); process.exit(1); }
  const data = acc.data;
  // PoolState layout: 8 disc + 32 admin + 32 relayer_address + 32 relayer_zk_pubkey + 8 locked_balance
  //   + 4 (vec len) + 32*100 root_history + 8 root_ptr + 8 next_idx + 32 current_root + 1 bump
  let off = 8 + 32 + 32 + 32 + 8;
  const vecLen = data.readUInt32LE(off); off += 4;
  const onchainRoots = [];
  for (let i = 0; i < vecLen; i++) { onchainRoots.push(be32ToDecimal(data.slice(off, off + 32))); off += 32; }
  const rootPtr = Number(data.readBigUInt64LE(off)); off += 8;
  const nextIdx = Number(data.readBigUInt64LE(off)); off += 8;
  const currentRoot = be32ToDecimal(data.slice(off, off + 32)); off += 32;

  console.log("\n=== On-chain PoolState ===");
  console.log("root_history len   :", vecLen);
  console.log("root_ptr           :", rootPtr);
  console.log("next_idx           :", nextIdx);
  console.log("current_root       :", currentRoot);

  const EMPTY = be32ToDecimal(Buffer.from([
    0x21,0x34,0xe7,0x6a,0xc5,0xd2,0x1a,0xab,0x18,0x6c,0x2b,0xe1,0xdd,0x8f,0x84,0xee,
    0x88,0x0a,0x1e,0x46,0xea,0xf7,0x12,0xf9,0xd3,0x71,0xb6,0xdf,0x22,0x19,0x1f,0x3e]));
  const nonEmpty = onchainRoots.filter(r => r !== EMPTY);
  console.log("non-empty roots    :", nonEmpty.length);
  const onchainSet = new Set(onchainRoots);

  console.log("\n=== KEY CHECKS ===");
  console.log("clientCurrentRoot in on-chain history? :", clientCurrentRoot ? onchainSet.has(clientCurrentRoot) : "n/a");
  console.log("DB latestRoot in on-chain history?     :", dbPool && dbPool.latestRoot ? onchainSet.has(dbPool.latestRoot) : "n/a");

  // Which rebuilt roots are NOT on-chain (these would fail verify_tree_roots as input)
  const missing = rebuiltRoots.filter(r => !onchainSet.has(r));
  console.log("rebuilt roots NOT on-chain:", missing.length, "of", rebuiltRoots.length);

  // Per-commitment: would withdrawing it succeed? (its proof root == clientCurrentRoot)
  console.log("\n=== Per-commitment withdrawability (input root = current tree root) ===");
  console.log("Every unspent note uses clientCurrentRoot as input root.");
  console.log("=> If clientCurrentRoot is NOT on-chain, EVERY withdraw/transfer fails.");

  // Show last few on-chain non-empty roots in insertion order
  console.log("\n=== On-chain roots in ring order (last 8 non-empty) ===");
  const ordered = [];
  for (let k = 0; k < vecLen; k++) {
    const idx = (rootPtr - vecLen + k + vecLen) % vecLen; // not exact; ring is overwritten
  }
  console.log(nonEmpty.slice(-8));
  console.log("\n=== DB roots (last 8) ===");
  console.log(dbRoots.slice(-8));

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error("DIAG ERROR:", e); process.exit(1); });
