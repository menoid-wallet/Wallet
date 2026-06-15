require("dotenv").config();

const { catchUpPools, startSyncLoop } = require("./indexer/poolIndexer");
const { catchUpSolana } = require("./indexer/solanaIndexer");
const { catchUpSui } = require("./indexer/suiIndexer");
const { catchUpAptos } = require("./indexer/aptosIndexer");

const express = require("express");
const cors    = require("cors");

const connectDB = require("./config/db");

const relayerRoutes      = require("./routes/relayer");
const transferRoutes     = require("./routes/transferRoutes");
const stateRoutes        = require("./routes/stateRoutes");
const userRoutes         = require("./routes/userRoutes");
const noidUserRoutes     = require("./routes/noidUserRoutes");
const noidAccountRoutes  = require("./routes/createNoidAccountRoutes");
const solanaRoutes       = require("./routes/solanaRoutes");
const suiRoutes          = require("./routes/suiRoutes");
const aptosRoutes        = require("./routes/aptosRoutes");

const { initializeRelayer } = require("./config/provider");

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Menoid Relayer backend running");
});

app.use("/api/relayer",     relayerRoutes);
app.use("/api/users",       userRoutes);
app.use("/api/noidusers",   noidUserRoutes);

// Network-aware routes — :network = monad | sepolia | base_sepolia
app.use("/api/state",       stateRoutes);
app.use("/api/transfer",    transferRoutes);
app.use("/api/noidroutes",  noidAccountRoutes);

// Solana, Sui, and Aptos routes
app.use("/api/solana",      solanaRoutes);
app.use("/api/sui",         suiRoutes);
app.use("/api/aptos",       aptosRoutes);

const PORT = process.env.PORT || 4000;

(async () => {
    await initializeRelayer();
    await connectDB();

    // Catch up ALL chains in parallel; only start server once all are done
    await Promise.all([
        catchUpPools(),
        catchUpSolana(),
        catchUpSui(),
        catchUpAptos()
    ]);

    // Start independent 10-second sync loops for each chain
    startSyncLoop();

    app.listen(PORT, () => {
        console.log(`✅ ✅ ✅ Server running on port ${PORT}`);
    });
})();