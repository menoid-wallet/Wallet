const mongoose = require("mongoose");

const poolStateSchema = new mongoose.Schema(
    {
        network: {
            type: String,
            required: true,
            enum: ["monad", "sepolia", "base_sepolia", "solana", "sui", "aptos"]
        },

        poolId: {
            type: String,
            required: true
        },

        commitments: {
            type: [String],
            default: []
        },

        encryptedNotes: {
            type: Map,
            of: String,
            default: {}
        },

        roots: {
            type: [String],
            default: []
        },

        latestRoot: {
            type: String,
            default: null
        },

        leafToIndex: {
            type: Map,
            of: Number,
            default: {}
        },

        lastProcessedBlock: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

// compound unique index: same poolId can exist on different networks
poolStateSchema.index({ network: 1, poolId: 1 }, { unique: true });

module.exports = mongoose.model("PoolState", poolStateSchema);