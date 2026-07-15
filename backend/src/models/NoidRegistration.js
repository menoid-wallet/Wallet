const mongoose = require("mongoose");

/**
 * NoidRegistration
 *
 * Off-chain lookup table for the register/user-commitment architecture.
 *
 * The user commitment itself lives on-chain (source of truth). This record
 * additionally stores the wallet's ENCRYPTION public key, which a sender needs
 * to encrypt a private note to the receiver but which cannot be recovered from
 * the on-chain user commitment (a hash). It is populated when the wallet submits
 * its register transaction through the backend.
 */
const noidRegistrationSchema = new mongoose.Schema(
    {
        network: { type: String, required: true },
        address: { type: String, required: true }, // lowercased real wallet address
        userCommitment: { type: String, required: true },
        encryptionPublicKey: { type: String, required: true }
    },
    { timestamps: true }
);

noidRegistrationSchema.index({ network: 1, address: 1 }, { unique: true });

module.exports = mongoose.model("NoidRegistration", noidRegistrationSchema);
