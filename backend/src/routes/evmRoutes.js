/**
 * evmRoutes.js
 *
 * EVM deposit & withdraw — user-signed transactions broadcast by the relayer.
 *   POST /api/evm/:network/deposit   body: { signedTx }
 *   POST /api/evm/:network/withdraw  body: { signedTx }
 *   :network = monad | sepolia | base_sepolia
 */
"use strict";

const express = require("express");
const { evmDepositController, evmWithdrawController } = require("../controllers/evm.controller");

const router = express.Router();

router.post("/:network/deposit", evmDepositController);
router.post("/:network/withdraw", evmWithdrawController);

module.exports = router;
