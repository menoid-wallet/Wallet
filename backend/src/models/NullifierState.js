const mongoose =
    require("mongoose");

const nullifierStateSchema =
    new mongoose.Schema({

        key: {
            type: String,
            default: "global",
            unique: true
        },

        nullifiers: {
            type: [String],
            default: []
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
        "NullifierState",
        nullifierStateSchema
    );