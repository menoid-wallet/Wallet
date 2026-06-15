/**
 * suiRoutes.js
 *
 * Exposes routes for Sui.
 */
"use strict";

const express = require("express");
const { suiDepositController, suiTransferController, suiWithdrawController } = require("../controllers/sui.controller");

const router = express.Router();

router.post("/deposit", suiDepositController);
router.post("/transfer", suiTransferController);
router.post("/withdraw", suiWithdrawController);

module.exports = router;
