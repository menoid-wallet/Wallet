const express =
    require("express");

const router =
    express.Router();

const PoolState =
    require("../models/PoolState");

const NullifierState =
    require("../models/NullifierState");


router.get(
    "/latest",
    async (req, res) => {

        try {

            const pools =
                await PoolState.find();

            const nullifierState =
                await NullifierState.findOne({
                    key: "global"
                });

            return res.json({

                spentNullifiers:
                    nullifierState
                        ?.nullifiers || [],

                poolStates:
                    pools || []
            });

        } catch (error) {

            console.error(error);

            return res.status(500).json({

                error:
                    "Failed to fetch sync state"
            });
        }
    }
);

module.exports = router;