/**
 * aptosRoutes.js
 *
 * Exposes routes for Aptos.
 */
"use strict";

const express = require("express");
const { aptosDepositController, aptosTransferController, aptosWithdrawController } = require("../controllers/aptos.controller");

const router = express.Router();

router.post("/deposit", aptosDepositController);
router.post("/transfer", aptosTransferController);
router.post("/withdraw", aptosWithdrawController);

module.exports = router;
