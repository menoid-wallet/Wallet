const express = require("express");

const PoolState        = require("../models/PoolState");
const NullifierState   = require("../models/NullifierState");
const NoidAccountState = require("../models/NoidAccountState");

const VALID_NETWORKS = new Set(["monad", "sepolia", "base_sepolia"]);

const router = express.Router();

// GET /api/state/:network/latest
router.get("/:network/latest", async (req, res) => {
    const { network } = req.params;

    if (!VALID_NETWORKS.has(network)) {
        return res.status(400).json({
            error: `Unknown network "${network}". Valid values: monad, sepolia, base_sepolia`
        });
    }

    try {
        const pools = await PoolState.find({ network });

        const nullifierState = await NullifierState.findOne({
            key: "global",
            network
        });

        const noidAccountState = await NoidAccountState.findOne({
            key: "global",
            network
        });

        return res.json({
            network,
            spentNullifiers:  nullifierState?.nullifiers       || [],
            poolStates:       pools                             || [],
            NoidAccountStates: noidAccountState?.noidAccounts  || []
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to fetch sync state" });
    }
});

module.exports = router;