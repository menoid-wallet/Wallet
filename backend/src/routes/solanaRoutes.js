/**
 * solanaRoutes.js
 *
 * Exposes routes for Solana.
 */
"use strict";

const express = require("express");
const { solanaDepositController, solanaTransferController, solanaWithdrawController } = require("../controllers/solana.controller");

const router = express.Router();

router.post("/deposit", solanaDepositController);
router.post("/transfer", solanaTransferController);
router.post("/withdraw", solanaWithdrawController);

module.exports = router;
