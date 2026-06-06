const express = require("express");

const { createNoidAccountController } = require("../controllers/createNoidAccountController");
const { executeFunctionController }   = require("../controllers/executeFunctionController");

const router = express.Router();

// POST /api/noidroutes/:network/createnoidaccount
// POST /api/noidroutes/:network/executefunction
// :network = monad | sepolia | base_sepolia

router.post("/:network/createnoidaccount", createNoidAccountController);
router.post("/:network/executefunction",   executeFunctionController);

module.exports = router;