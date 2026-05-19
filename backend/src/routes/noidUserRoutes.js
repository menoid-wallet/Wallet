const express =
    require("express");

const router =
    express.Router();

const {

    createNoidUser,

    getAllNoidUsers

} = require(
    "../controllers/noidModeUserController"
);


router.post(
    "/create",
    createNoidUser
);

router.get(
    "/all",
    getAllNoidUsers
);

module.exports = router;