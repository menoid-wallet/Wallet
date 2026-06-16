const express = require("express");
const router  = express.Router();

const providerModule = require("../config/provider");
const { buildWallet } = require("../config/provider");

// GET /api/relayer/get?network=monad|sepolia|base_sepolia|solana|sui|aptos
router.get("/get", async (req, res) => {
    try {
        const network = req.query.network || "monad";

        if (network === "solana") {
            if (!providerModule.solanaRelayerWallet) {
                return res.status(500).json({ error: "Solana relayer wallet not initialized" });
            }
            return res.json({
                publicKey:   providerModule.solanaRelayerWallet.privateWallet.publicKey,
                zkPublicKey: providerModule.solanaRelayerWallet.zk.publicKey
            });
        } else if (network === "sui") {
            if (!providerModule.suiRelayerWallet) {
                return res.status(500).json({ error: "Sui relayer wallet not initialized" });
            }
            return res.json({
                publicKey:   providerModule.suiRelayerWallet.privateWallet.publicKey,
                zkPublicKey: providerModule.suiRelayerWallet.zk.publicKey
            });
        } else if (network === "aptos") {
            if (!providerModule.aptosRelayerWallet) {
                return res.status(500).json({ error: "Aptos relayer wallet not initialized" });
            }
            return res.json({
                publicKey:   providerModule.aptosRelayerWallet.privateWallet.publicKey,
                zkPublicKey: providerModule.aptosRelayerWallet.zk.publicKey
            });
        } else {
            // EVM (monad, sepolia, base_sepolia)
            if (!providerModule.relayerWallet) {
                return res.status(500).json({ error: "EVM relayer wallet not initialized" });
            }
            return res.json({
                publicKey:   providerModule.relayerWallet.privateWallet.publicKey,
                zkPublicKey: providerModule.relayerWallet.zk.publicKey
            });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to fetch relayer wallet" });
    }
});

// GET /api/relayer/wallet?network=monad|sepolia|base_sepolia|solana|sui|aptos
// defaults to monad if no query param provided
router.get("/wallet", async (req, res) => {
    const network = req.query.network || "monad";
    const valid   = new Set(["monad", "sepolia", "base_sepolia", "solana", "sui", "aptos"]);

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