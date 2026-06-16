"use strict";
require("dotenv").config();
const fs = require("fs");
const { program, programId, connection } = require("./src/config/solanaProvider");

function beToDecimal(b){let r=0n;for(const x of b)r=(r<<8n)+BigInt(x);return r.toString();}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Discriminators (first 8 bytes of each event's base64 payload)
// NoteCreatedEvent  payload = disc[8] + pool_id u64[8] + commitment[32] = 48 bytes
// NullifierSpentEvent payload = disc[8] + nullifier[32] = 40 bytes
async function withRetry(fn, label) {
  let delay = 2000;
  for (let attempt = 0; attempt < 8; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (String(e).includes("429") || String(e).includes("Too Many")) { await sleep(delay); delay = Math.min(delay*1.7, 20000); }
      else throw e;
    }
  }
  throw new Error(`${label}: exhausted retries`);
}

function decodeProgramData(logs) {
  const out = { commitments: [], nullifiers: [] };
  for (const line of logs) {
    const m = line.match(/^Program data: (.+)$/);
    if (!m) continue;
    const buf = Buffer.from(m[1], "base64");
    if (buf.length === 48) {
      // NoteCreatedEvent: skip 8 disc + 8 pool_id, take 32 commitment (big-endian)
      out.commitments.push(beToDecimal(buf.slice(16, 48)));
    } else if (buf.length === 40) {
      // NullifierSpentEvent: skip 8 disc, take 32 nullifier
      out.nullifiers.push(beToDecimal(buf.slice(8, 40)));
    }
  }
  return out;
}

(async () => {
  const sigs = await withRetry(() => connection.getSignaturesForAddress(programId, { limit: 1000 }), "getSignatures");
  const valid = sigs.filter(s => !s.err).sort((a, b) => a.slot - b.slot);
  console.log("valid sigs:", valid.length);

  const commitments = [], nullifiers = [], perTx = [];
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    await sleep(1500);
    const tx = await withRetry(() => connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }), `tx[${i}]`);
    const logs = tx?.meta?.logMessages || [];
    const instr = (logs.find(l => l.startsWith("Program log: Instruction:")) || "").replace("Program log: Instruction: ", "");
    const dec = decodeProgramData(logs);
    commitments.push(...dec.commitments);
    nullifiers.push(...dec.nullifiers);
    perTx.push({ i, slot: s.slot, instr, commitments: dec.commitments, nullifiers: dec.nullifiers });
    console.log(`  tx[${i}] slot ${s.slot} [${instr}]: +${dec.commitments.length} notes, +${dec.nullifiers.length} nulls`);
  }

  fs.writeFileSync(__dirname + "/chain_solana.json", JSON.stringify({ commitments, nullifiers, perTx }, null, 2));
  console.log("\nTOTAL commitments:", commitments.length, "| nullifiers:", nullifiers.length);
  process.exit(0);
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
