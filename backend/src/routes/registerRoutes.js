/**
 * registerRoutes.js
 *
 * On-chain wallet registration relayed by the backend.
 *   POST /api/register/:network                  body: chain-specific signed tx
 *   GET  /api/register/:network/status/:address  on-chain registration check
 *   :network = monad | sepolia | base_sepolia | solana | sui | aptos
 */
"use strict";

const express = require("express");
const {
    registerController,
    registerStatusController
} = require("../controllers/register.controller");

const router = express.Router();

router.post("/:network", registerController);
router.get("/:network/status/:address", registerStatusController);

module.exports = router;
