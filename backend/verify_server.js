/**
 * verify_server.js — boot verification harness.
 *
 * Boots the backend on an alternate port WITHOUT the EVM block-indexer/sync-loop
 * (the already-running production instance owns EVM indexing; a second EVM loop
 * would double-process blocks). This exercises everything the Solana/Sui/Aptos
 * rewrite touches: DB connect, relayer providers, the DB-rebuild loaders (incl.
 * the Aptos subtree mirror), and all route mounts.
 */
require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");

const connectDB = require("./src/config/db");
const { catchUpSolana } = require("./src/indexer/solanaIndexer");
const { catchUpSui } = require("./src/indexer/suiIndexer");
const { catchUpAptos } = require("./src/indexer/aptosIndexer");

const solanaRoutes = require("./src/routes/solanaRoutes");
const suiRoutes = require("./src/routes/suiRoutes");
const aptosRoutes = require("./src/routes/aptosRoutes");
const stateRoutes = require("./src/routes/stateRoutes");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => res.send("Menoid verify harness running"));
app.use("/api/solana", solanaRoutes);
app.use("/api/sui", suiRoutes);
app.use("/api/aptos", aptosRoutes);
app.use("/api/state", stateRoutes);

const PORT = process.env.VERIFY_PORT || 4100;

(async () => {
    console.log("[verify] connecting DB...");
    await connectDB();
    console.log("[verify] loading Solana/Sui/Aptos pools from DB...");
    await Promise.all([catchUpSolana(), catchUpSui(), catchUpAptos()]);
    app.listen(PORT, () => console.log(`[verify] ✅ harness listening on ${PORT}`));
})().catch((e) => {
    console.error("[verify] boot failed:", e);
    process.exit(1);
});
