/**
 * aptosRoutes.js
 *
 * Exposes routes for Aptos.
 */
"use strict";

const express = require("express");
const { aptosDepositController, aptosTransferController, aptosWithdrawController } = require("../controllers/aptos.controller");
const { relayerAccount } = require("../config/aptosProvider");

const router = express.Router();

router.get("/relayer-address", (req, res) => {
    try {
        return res.json({ address: relayerAccount.accountAddress.toString() });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to get Aptos relayer address" });
    }
});

router.post("/deposit", aptosDepositController);
router.post("/transfer", aptosTransferController);
router.post("/withdraw", aptosWithdrawController);

module.exports = router;
