const mongoose = require("mongoose");

const nullifierStateSchema = new mongoose.Schema({
    key: {
        type: String,
        default: "global"
    },

    network: {
        type: String,
        required: true,
        enum: ["monad", "sepolia", "base_sepolia", "solana", "sui", "aptos"]
    },

    nullifiers: {
        type: [String],
        default: []
    },

    lastProcessedBlock: {
        type: Number,
        default: 0
    }
});

// compound unique index: one NullifierState per (network, key) pair
nullifierStateSchema.index({ network: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("NullifierState", nullifierStateSchema);