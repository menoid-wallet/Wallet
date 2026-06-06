const mongoose = require("mongoose");

const noteStateSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true
    },

    network: {
        type: String,
        required: true,
        enum: ["monad", "sepolia", "base_sepolia"]
    },

    lastProcessedBlock: {
        type: Number,
        required: true
    }
});

// compound unique index: one NoteState per (network, key) pair
noteStateSchema.index({ network: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("NoteState", noteStateSchema);