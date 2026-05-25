const express = require("express");

const {
    createNoidAccountController
} = require("../controllers/createNoidAccountController");

const router = express.Router();

router.post(
    "/createnoidaccount",
    createNoidAccountController
);

module.exports = router;