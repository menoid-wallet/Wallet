require("dotenv").config();

const { catchUpPools, verifyPoolsAgainstChain } = require("./indexer/poolIndexer");
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
const feedbackRoutes     = require("./routes/feedbackRoutes");
const solanaRoutes       = require("./routes/solanaRoutes");
const suiRoutes          = require("./routes/suiRoutes");
const aptosRoutes        = require("./routes/aptosRoutes");
const evmRoutes          = require("./routes/evmRoutes");
const registerRoutes     = require("./routes/registerRoutes");
const analyticsRoutes    = require("./routes/analyticsRoutes");

const { initializeRelayer } = require("./config/provider");
const { verifyEvmDeployments, verifyOtherDeployments } = require("./helpers/verifyDeployment");

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Menoid Relayer backend running");
});

app.use("/api/relayer",     relayerRoutes);
app.use("/api/users",       userRoutes);
app.use("/api/noidusers",   noidUserRoutes);
app.use("/api/feedback",    feedbackRoutes);

// Our own analytics: install counts and product events (see analyticsController)
app.use("/api/analytics",   analyticsRoutes);

// Network-aware routes — :network = monad | sepolia | base_sepolia
app.use("/api/state",       stateRoutes);
app.use("/api/transfer",    transferRoutes);

// Solana, Sui, and Aptos routes
app.use("/api/solana",      solanaRoutes);
app.use("/api/sui",         suiRoutes);
app.use("/api/aptos",       aptosRoutes);

// EVM deposit/withdraw (user-signed txn → relayer broadcasts) — monad | sepolia | base_sepolia
app.use("/api/evm",         evmRoutes);

// On-chain wallet registration (user-signed tx relayed by the backend)
app.use("/api/register",    registerRoutes);

const PORT = process.env.PORT || 4000;

(async () => {
    console.log("server started");
    await initializeRelayer();
    await connectDB();

    /* Before serving anything: are the configured pool addresses the contracts
       this build expects? Addresses live in the environment, code lives in the
       repo, and the two drift apart silently — a relayer pointed at an old pool
       broadcasts fine and indexes nothing. Say so in the logs, loudly.
       Set STRICT_DEPLOY_CHECK=1 to refuse to start instead. */
    console.log("\n========== DEPLOYMENT CHECK ==========");
    await verifyEvmDeployments({ exitOnMismatch: process.env.STRICT_DEPLOY_CHECK === "1" });
    await verifyOtherDeployments();
    console.log("======================================\n");

    // Load existing pool state for ALL chains from the DB (no block scanning).
    // Every route updates the pools inline after its tx confirms.
    await Promise.all([
        catchUpPools(),
        catchUpSolana(),
        catchUpSui(),
        catchUpAptos()
    ]);

    app.listen(PORT, () => {
        console.log(`✅ ✅ ✅ Server running on port ${PORT}`);
    });

    /* Prove every EVM tree matches its contract's root, repairing any that
       don't. In the background, under each network's indexing lock, so the
       server is reachable immediately and nothing is indexed against a tree
       that hasn't been checked. */
    console.log("\n========== TREE CHECK ==========");
    verifyPoolsAgainstChain()
        .then(() => console.log("================================\n"))
        .catch((e) => console.error("tree check failed:", e.message));
})();