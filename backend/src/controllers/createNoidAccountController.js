const snarkjs =
    require("snarkjs");

const { ethers } =
    require("ethers");

const {
    decryptMessage
} = require("../helpers/crypto");

const provider =
    require("../config/provider");

const {
    wallet
} = require("../config/provider");

const {
    spentNullifiers
} = require("../indexer/poolIndexer");

const createNoidAccountVKey =
    require("../zk/create_noid_account_verification_key.json");

const ZERO_COMMITMENT =
    ethers.ZeroHash;

const NOID_ACCOUNT_MANAGER_ABI = require("../abis/NoidAccountManager.json")

// =====================================================================
// NoidAccountManager contract instance
// =====================================================================


function getNoidAccountManager() {
    const address =
        process.env.NOID_ACCOUNT_MANAGER_ADDRESS;

    if (!address) {
        throw new Error(
            "NOID_ACCOUNT_MANAGER_ADDRESS env var not set"
        );
    }

    return new ethers.Contract(
        address,
        NOID_ACCOUNT_MANAGER_ABI,
        provider.provider
    );
}

// =====================================================================
// BUILD PUBLIC SIGNALS
// public signals order (matches circuit component main):
//   relayer          — 1
//   enabled[4]       — 4
//   roots[4]         — 4
//   nullifiers[4]    — 4
//   out_enabled[2]   — 2
//   c_outs[2]        — 2
//   cmx_noirAccount  — 1
//                      = 18 total
// =====================================================================

function buildPublicSignals(call, cmx) {

    const publicSignals = [];

    // relayer zk pubkey
    publicSignals.push(
        provider.relayerWallet.zk.publicKey.toString()
    );

    // enabled[4]
    for (const e of call.inputs.enabled) {
        publicSignals.push(
            e.toString()
        );
    }

    // roots[4]
    for (const root of call.inputs.roots) {
        publicSignals.push(
            BigInt(root).toString()
        );
    }

    // nullifiers[4]
    for (const n of call.inputs.nullifiers) {
        publicSignals.push(
            BigInt(n).toString()
        );
    }

    // out_enabled[2]  — derived from C1/C2 being zero or not
    publicSignals.push(
        call.C1 !== ZERO_COMMITMENT ? "1" : "0"
    );
    publicSignals.push(
        call.C2 !== ZERO_COMMITMENT ? "1" : "0"
    );

    // c_outs[2]
    publicSignals.push(
        BigInt(call.C1).toString()
    );
    publicSignals.push(
        BigInt(call.C2).toString()
    );

    // cmx_noirAccount — the account ownership commitment
    publicSignals.push(
        BigInt(cmx).toString()
    );

    return publicSignals;
}

// =====================================================================
// BUILD PROOF OBJECT  (same shape as transferController)
// =====================================================================

function buildProof(call) {
    return {
        pi_a:     call.a,
        pi_b:     call.b,
        pi_c:     call.c,
        protocol: "groth16",
        curve:    "bn128"
    };
}

// =====================================================================
// CONTROLLER
// =====================================================================

async function createNoidAccountController(req, res) {

    try {

        const {
            calls,   // CreateNoidAccountCall[]
            cmx,     // bytes32 — ownership commitment of the new account
            eNote,   // bytes   — encrypted account note (randomness for owner)
            zkProofs // proof[] — one proof per call, same index
        } = req.body;

        // ------------------------------------------------------------------
        // BASIC VALIDATION
        // ------------------------------------------------------------------

        if (!Array.isArray(calls) || calls.length === 0) {
            return res.status(400).json({
                success: false,
                message: "calls must be a non-empty array"
            });
        }

        if (!Array.isArray(zkProofs) || zkProofs.length !== calls.length) {
            return res.status(400).json({
                success: false,
                message: "zkProofs must be an array with one entry per call"
            });
        }

        if (!cmx || cmx === ZERO_COMMITMENT) {
            return res.status(400).json({
                success: false,
                message: "cmx (account commitment) is required"
            });
        }

        if (!eNote) {
            return res.status(400).json({
                success: false,
                message: "eNote (encrypted account note) is required"
            });
        }

        // ------------------------------------------------------------------
        // VERIFY ZK PROOFS
        // ------------------------------------------------------------------

        for (let i = 0; i < calls.length; i++) {

            const call   = calls[i];
            const proof  = zkProofs[i];
            const signals = buildPublicSignals(call, cmx);

            // console.log(
            //     `[createNoidAccount] call ${i} public signals:`,
            //     signals
            // );

            const verified = await snarkjs.groth16.verify(
                createNoidAccountVKey,
                signals,
                proof
            );

            // console.log(
            //     `[createNoidAccount] call ${i} verified:`,
            //     verified
            // );

            if (!verified) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid ZK proof for call index ${i}`
                });
            }
        }

        // ------------------------------------------------------------------
        // NULLIFIER CHECK  — ensure no input has already been spent
        // ------------------------------------------------------------------

        for (const call of calls) {
            for (const nullifier of call.inputs.nullifiers) {

                // skip zero (disabled input slot)
                if (nullifier === ZERO_COMMITMENT) {
                    continue;
                }

                const parsed = BigInt(nullifier).toString();

                if (spentNullifiers.has(parsed)) {
                    return res.status(400).json({
                        success: false,
                        message: "Nullifier already spent"
                    });
                }
            }
        }

        // ------------------------------------------------------------------
        // DECRYPT RELAYER NOTES  — compute total relayer fee
        // encryptedNote2 is always the relayer's output note (C2)
        // ------------------------------------------------------------------

        let totalRelayerFee = 0n;

        for (const call of calls) {

            // If C2 is zero this batch has no relayer output — skip
            if (call.C2 === ZERO_COMMITMENT) {
                continue;
            }

            try {
                const decrypted = decryptMessage(
                    call.encryptedNote2,
                    provider.relayerWallet.privateWallet.privateKey
                );

                const parsed = JSON.parse(decrypted);

                totalRelayerFee += BigInt(parsed.amount);

            } catch (_) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid or undecryptable relayer encrypted note (encryptedNote2)"
                });
            }
        }

        // console.log(
        //     "[createNoidAccount] total relayer fee (wei):",
        //     totalRelayerFee.toString()
        // );

        // ------------------------------------------------------------------
        // ESTIMATE GAS
        // ------------------------------------------------------------------

        const noidAccountManager = getNoidAccountManager();

        const gasEstimate = await noidAccountManager
            .connect(wallet)
            .createNoidAccount
            .estimateGas(calls, cmx, eNote);

        const feeData  = await provider.provider.getFeeData();
        const gasPrice = feeData.gasPrice;

        if (!gasPrice) {
            return res.status(500).json({
                success: false,
                message: "Unable to fetch gas price"
            });
        }

        const estimatedCost = gasEstimate * gasPrice;

        // console.log(
        //     "[createNoidAccount] gas estimate:", gasEstimate.toString(),
        //     "| gas price:", gasPrice.toString(),
        //     "| estimated cost (wei):", estimatedCost.toString()
        // );

        // ------------------------------------------------------------------
        // PROFITABILITY CHECK
        // ------------------------------------------------------------------

        if (totalRelayerFee < estimatedCost) {
            return res.status(400).json({
                success: false,
                message:    "Relayer fee insufficient to cover gas",
                estimatedCost:   estimatedCost.toString(),
                totalRelayerFee: totalRelayerFee.toString()
            });
        }

        // ------------------------------------------------------------------
        // SUBMIT TRANSACTION
        // ------------------------------------------------------------------

        const tx = await noidAccountManager
            .connect(wallet)
            .createNoidAccount(calls, cmx, eNote);

        console.log(
            "[createNoidAccount] tx submitted:", tx.hash
        );

        const receipt = await tx.wait();

        // console.log(
        //     "[createNoidAccount] confirmed in block:", receipt.blockNumber
        // );

        // ------------------------------------------------------------------
        // SUCCESS
        // ------------------------------------------------------------------

        return res.json({
            success:         true,
            txHash:          receipt.hash,
            gasUsed:         receipt.gasUsed.toString(),
            totalRelayerFee: totalRelayerFee.toString(),
            estimatedCost:   estimatedCost.toString()
        });

    } catch (err) {

        console.error("[createNoidAccount] error:", err);

        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
}

module.exports = {
    createNoidAccountController
};