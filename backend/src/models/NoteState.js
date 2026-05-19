const mongoose =
    require("mongoose");

const noteStateSchema =
    new mongoose.Schema({

        key: {
            type: String,
            unique: true
        },

        lastProcessedBlock: {
            type: Number,
            required: true
        }

    });

module.exports =
    mongoose.model(
        "NoteState",
        noteStateSchema
    );