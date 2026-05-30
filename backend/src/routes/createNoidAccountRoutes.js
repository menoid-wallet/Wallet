const express = require("express");

const {
    createNoidAccountController
} = require("../controllers/createNoidAccountController");

const {
    executeFunctionController
} = require("../controllers/executeFunctionController");
const router = express.Router();

router.post(
    "/createnoidaccount",
    createNoidAccountController
);

router.post("/executefunction", executeFunctionController);
module.exports = router;