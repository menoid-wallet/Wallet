"use strict";
require("dotenv").config();
const fs = require("fs");
const mongoose = require("mongoose");
const { Connection, PublicKey } = require("@solana/web3.js");
const circomlibjs = require("circomlibjs");
const { IncrementalMerkleTree } = require("@zk-kit/incremental-merkle-tree");

const POOL_PDA = new PublicKey(process.env.SOLANA_POOL_STATE_PDA);
function be(b){let r=0n;for(const x of b)r=(r<<8n)+BigInt(x);return r.toString();}

(async () => {
  const chain = JSON.parse(fs.readFileSync(__dirname + "/chain_solana.json"));
  const poseidon = await circomlibjs.buildPoseidon();
  const hash = (inp) => BigInt(poseidon.F.toString(poseidon(inp)));
  const tree = new IncrementalMerkleTree(hash, 20, BigInt(0), 2);
  const cleanRoots = [];
  for (const c of chain.commitments) { tree.insert(BigInt(c)); cleanRoots.push(tree.root.toString()); }

  // on-chain ordered roots
  const conn = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
  const acc = await conn.getAccountInfo(POOL_PDA);
  let off = 8+32+32+32+8;
  const vecLen = acc.data.readUInt32LE(off); off += 4;
  const ring = [];
  for (let i=0;i<vecLen;i++){ring.push(be(acc.data.slice(off,off+32)));off+=32;}
  const nextIdx = Number(acc.data.readBigUInt64LE(off+8));
  const onchain = ring.slice(0, nextIdx);

  await mongoose.connect(process.env.MONGO_URI);
  const PoolState = require("./src/models/PoolState");
  const dbPool = await PoolState.findOne({ network: "solana", poolId: "0" });
  const dbRoots = dbPool.roots;

  // map each commitment to which tx/instr created it
  const cmxTx = {};
  for (const t of chain.perTx) for (const c of t.commitments) cmxTx[c] = `${t.instr}@slot${t.slot}`;

  console.log("leaf | clean==onchain | onchain==db | createdBy");
  for (let i = 0; i < nextIdx; i++) {
    const c = chain.commitments[i];
    console.log(
      `${String(i).padStart(2)}   | ${cleanRoots[i]===onchain[i] ? "OK ":"XX "}          | ${onchain[i]===dbRoots[i]?"OK ":"XX "}        | ${cmxTx[c]}`
    );
  }
  // show first divergence detail
  const d = (() => { for (let i=0;i<nextIdx;i++) if (cleanRoots[i]!==onchain[i]) return i; return -1; })();
  if (d>=0){
    console.log(`\nFirst divergence at leaf ${d} (created by ${cmxTx[chain.commitments[d]]}):`);
    console.log("  clean  :", cleanRoots[d]);
    console.log("  onchain:", onchain[d]);
  } else console.log("\nNo divergence — clean rebuild matches on-chain fully.");

  await mongoose.disconnect(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
