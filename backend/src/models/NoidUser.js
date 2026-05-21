const mongoose =
    require("mongoose");

const noidModeUserSchema =
    new mongoose.Schema({

        name: {
            type: String,
            required: true
        },

        noidModePublicKey: {
            type: String,
            required: true,
            unique: true
        },

        zkPublicKey: {
            type: String,
            required: true
        }

    }, {
        timestamps: true
    });

module.exports =
    mongoose.model(
        "NoidModeUser",
        noidModeUserSchema
    );