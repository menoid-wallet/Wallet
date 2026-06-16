/**
 * suiRoutes.js
 *
 * Exposes routes for Sui.
 */
"use strict";

const express = require("express");
const { suiDepositController, suiTransferController, suiWithdrawController } = require("../controllers/sui.controller");
const { relayerAddress } = require("../config/suiProvider");

const router = express.Router();

router.get("/relayer-address", (req, res) => {
    try {
        return res.json({ address: relayerAddress });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to get Sui relayer address" });
    }
});

router.post("/deposit", suiDepositController);
router.post("/transfer", suiTransferController);
router.post("/withdraw", suiWithdrawController);

module.exports = router;
