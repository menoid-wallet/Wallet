const mongoose = require("mongoose");

const noidAccountStateSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            default: "global"
        },

        network: {
            type: String,
            required: true,
            enum: ["monad", "sepolia", "base_sepolia"]
        },

        noidAccounts: {
            type: [
                {
                    noidAccountAddress: String,
                    ownerCommitment: String,
                    encryptedNote: String
                }
            ],
            default: []
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

// compound unique index: one NoidAccountState per (network, key) pair
noidAccountStateSchema.index({ network: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("NoidAccountState", noidAccountStateSchema);