const express = require("express");
const router  = express.Router();

const providerModule = require("../config/provider");
const { buildWallet } = require("../config/provider");

// GET /api/relayer/get  — relayer public keys (shared across all chains)
router.get("/get", async (req, res) => {
    try {
        return res.json({
            publicKey:   providerModule.relayerWallet.privateWallet.publicKey,
            zkPublicKey: providerModule.relayerWallet.zk.publicKey
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to fetch relayer wallet" });
    }
});

// GET /api/relayer/wallet?network=monad|sepolia|base_sepolia
// defaults to monad if no query param provided
router.get("/wallet", async (req, res) => {
    const network = req.query.network || "monad";
    const valid   = new Set(["monad", "sepolia", "base_sepolia"]);

    if (!valid.has(network)) {
        return res.status(400).json({ error: `Unknown network "${network}"` });
    }

    try {
        const wallet = await buildWallet(network);
        return res.json({
            network,
            balance: wallet.balance.toString(),
            notes:   wallet.notes
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to build relayer wallet" });
    }
});

module.exports = router;