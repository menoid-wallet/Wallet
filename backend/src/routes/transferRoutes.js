const express = require("express");
const { transferController } = require("../controllers/transfer.controller");

const router = express.Router();

// POST /api/transfer/:network/transfer
// :network = monad | sepolia | base_sepolia
router.post("/:network/transfer", transferController);

module.exports = router;