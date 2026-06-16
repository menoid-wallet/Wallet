"use strict";
require("dotenv").config();
const { connection, program, programId } = require("./src/config/solanaProvider");
const { EventParser } = require("@coral-xyz/anchor");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const sigs = (await connection.getSignaturesForAddress(programId, { limit: 1000 }))
    .filter(s => !s.err).sort((a, b) => a.slot - b.slot);
  // dump a late tx that should have commitments
  for (const idx of [8, 9, 10, 11]) {
    const s = sigs[idx];
    await sleep(1500);
    const tx = await connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    console.log(`\n===== tx[${idx}] slot ${s.slot} =====`);
    console.log((tx?.meta?.logMessages || []).join("\n"));
  }
  console.log("\n=== IDL events ===");
  console.log((program.idl.events || []).map(e => e.name));
  console.log("=== IDL has account types? ===", (program.idl.accounts||[]).map(a=>a.name));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
