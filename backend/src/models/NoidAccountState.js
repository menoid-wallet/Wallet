const mongoose =
    require("mongoose");

const noidAccountStateSchema =
    new mongoose.Schema({

        key: {
            type: String,
            default: "global",
            unique: true
        },

        noidAccounts: {

            type: [
                {
                    noidAccountAddress:
                        String,

                    ownerCommitment:
                        String,

                    encryptedNote:
                        String
                }
            ],

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
        "NoidAccountState",
        noidAccountStateSchema
    );

