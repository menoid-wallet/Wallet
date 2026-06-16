/**
 * solanaRoutes.js
 *
 * Exposes routes for Solana.
 */
"use strict";

const express = require("express");
const { solanaDepositController, solanaTransferController, solanaWithdrawController } = require("../controllers/solana.controller");
const { relayerKeypair } = require("../config/solanaProvider");

const router = express.Router();

router.get("/relayer-pubkey", (req, res) => {
    try {
        return res.json({ pubkey: relayerKeypair.publicKey.toBase58() });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to get Solana relayer pubkey" });
    }
});

router.post("/deposit", solanaDepositController);
router.post("/transfer", solanaTransferController);
router.post("/withdraw", solanaWithdrawController);

module.exports = router;
