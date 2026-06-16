"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const { Connection, PublicKey } = require("@solana/web3.js");
const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const POOL_PDA = new PublicKey(process.env.SOLANA_POOL_STATE_PDA);
function be32ToDecimal(b){let r=0n;for(const x of b)r=(r<<8n)+BigInt(x);return r.toString();}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const PoolState = require("./src/models/PoolState");
  const dbPool = await PoolState.findOne({ network: "solana", poolId: "0" });
  const encNotes = Object.fromEntries(dbPool.encryptedNotes);

  // read on-chain root_history (ring buffer, not yet wrapped: next_idx <= 100)
  const conn = new Connection(RPC, "confirmed");
  const acc = await conn.getAccountInfo(POOL_PDA);
  const data = acc.data;
  let off = 8 + 32 + 32 + 32 + 8;
  const vecLen = data.readUInt32LE(off); off += 4;
  const ring = [];
  for (let i = 0; i < vecLen; i++) { ring.push(be32ToDecimal(data.slice(off, off + 32))); off += 32; }
  const rootPtr = Number(data.readBigUInt64LE(off)); off += 8;
  const nextIdx = Number(data.readBigUInt64LE(off)); off += 8;
  const currentRoot = be32ToDecimal(data.slice(off, off + 32));

  // insertion-order roots: positions 0..nextIdx-1 (no wrap since nextIdx=11 < 100)
  const orderedRoots = ring.slice(0, nextIdx);
  console.log("nextIdx:", nextIdx, "| ordered on-chain roots:", orderedRoots.length);

  const poseidon = await circomlibjs.buildPoseidon();
  const hash = (inp) => BigInt(poseidon.F.toString(poseidon(inp)));

  // Greedy reconstruction: at each step, find the unused commitment whose insertion yields orderedRoots[i]
  const pool = [...dbPool.commitments];
  const used = new Array(pool.length).fill(false);
  const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);
  const correctOrder = [];
  let ok = true;
  for (let i = 0; i < orderedRoots.length; i++) {
    let found = -1;
    for (let j = 0; j < pool.length; j++) {
      if (used[j]) continue;
      // try insert on a clone
      const t2 = tree.clone ? tree.clone() : null;
      let candRoot;
      if (t2) { t2.insert(BigInt(pool[j])); candRoot = t2.root.toString(); }
      else {
        // rebuild manually: insert then check, then we must not mutate `tree` — so rebuild from correctOrder
        const tmp = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);
        for (const c of correctOrder) tmp.insert(BigInt(c));
        tmp.insert(BigInt(pool[j]));
        candRoot = tmp.root.toString();
      }
      if (candRoot === orderedRoots[i]) { found = j; break; }
    }
    if (found === -1) { console.log(`  position ${i}: NO commitment reproduces root ${orderedRoots[i].slice(0,18)}`); ok = false; break; }
    used[found] = true;
    tree.insert(BigInt(pool[found]));
    correctOrder.push(pool[found]);
  }

  console.log("\nReconstruction ok?", ok);
  if (ok) {
    const finalRoot = tree.root.toString();
    console.log("reconstructed final root:", finalRoot);
    console.log("on-chain current_root   :", currentRoot);
    console.log("MATCH?", finalRoot === currentRoot);
    console.log("\nCorrect insertion order vs current DB array order:");
    for (let i = 0; i < correctOrder.length; i++) {
      const dbPos = dbPool.commitments.indexOf(correctOrder[i]);
      console.log(`  leaf ${String(i).padStart(2)} <- ${correctOrder[i].slice(0,16)}  (was DB array idx ${dbPos}, hasNote=${encNotes[correctOrder[i]]?"y":"n"})`);
    }
    const unusedC = pool.filter((_, j) => !used[j]);
    console.log("\nDB commitments NOT used in reconstruction:", unusedC.map(c=>c.slice(0,16)));
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
