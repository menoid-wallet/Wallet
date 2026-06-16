const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey } = require("@solana/web3.js");

const PROGRAM_ID = new PublicKey(
  "3wxDTqw42qqftiAcTZ6kLeNtepuSmB1mR1skrEcwD9SC"
);

const idl = require("./src/abis/solana/noid_solana.json");

const connection = new Connection(
  "https://api.devnet.solana.com",
  "confirmed"
);

async function main() {
  const coder = new anchor.BorshEventCoder(idl);
  const parser = new anchor.EventParser(PROGRAM_ID, coder);

  const sigs = await connection.getSignaturesForAddress(PROGRAM_ID);

  const commitments = [];

  for (const sigInfo of sigs.reverse()) {
    const tx = await connection.getTransaction(
      sigInfo.signature,
      { maxSupportedTransactionVersion: 0 }
    );

    if (!tx?.meta?.logMessages) continue;

    for (const event of parser.parseLogs(tx.meta.logMessages)) {
      if (event.name === "NoteCreatedEvent") {
        commitments.push({
          time: sigInfo.blockTime,
          commitment: Buffer.from(event.data.commitment).toString("hex"),
        });
      }
    }
  }

  console.log(commitments);
}

main().catch(console.error);