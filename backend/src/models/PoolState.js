const mongoose =
    require("mongoose");

const poolStateSchema =
    new mongoose.Schema({

        poolId: {
            type: String,
            required: true,
            unique: true
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

    }, {
        timestamps: true
    });

module.exports =
    mongoose.model(
        "PoolState",
        poolStateSchema
    );