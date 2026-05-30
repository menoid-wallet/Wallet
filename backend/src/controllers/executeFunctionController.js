const snarkjs = require("snarkjs");
const { ethers } = require("ethers");
const { decryptMessage } = require("../helpers/crypto");
const provider = require("../config/provider");
const { wallet } = require("../config/provider");
const { spentNullifiers } = require("../indexer/poolIndexer");

const executeFunCallVKey = require("../zk/execute_call_verification_key.json");
const noidAccountOwnershipVKey = require("../zk/noid_account_ownership_verification_key.json");

const NOID_ACCOUNT_MANAGER_ABI = require("../abis/NoidAccountManager.json");

const ZERO_COMMITMENT = ethers.ZeroHash;

// =====================================================================
// NoidAccountManager contract instance
// =====================================================================

function getNoidAccountManager() {
    const address = process.env.NOID_ACCOUNT_MANAGER_ADDRESS;
    if (!address) {
        throw new Error("NOID_ACCOUNT_MANAGER_ADDRESS env var not set");
    }
    return new ethers.Contract(address, NOID_ACCOUNT_MANAGER_ABI, provider.provider);
}

// =====================================================================
// BUILD PUBLIC SIGNALS FOR ExecuteFunctionCall proof
//
// Public signals order (matches ExecuteCallProof circuit main):
//   relayer          — 1
//   enabled[4]       — 4
//   roots[4]         — 4
//   nullifiers[4]    — 4
//   out_enabled[2]   — 2
//   c_outs[2]        — 2
//   callValue        — 1
//                      = 18 total
// =====================================================================

function buildExecuteCallPublicSignals(call) {
    const publicSignals = [];

    publicSignals.push(provider.relayerWallet.zk.publicKey.toString());

    for (const e of call.inputs.enabled) {
        publicSignals.push(e.toString());
    }
    for (const root of call.inputs.roots) {
        publicSignals.push(BigInt(root).toString());
    }
    for (const n of call.inputs.nullifiers) {
        publicSignals.push(BigInt(n).toString());
    }

    publicSignals.push(call.C1 !== ZERO_COMMITMENT ? "1" : "0");
    publicSignals.push(call.C2 !== ZERO_COMMITMENT ? "1" : "0");

    publicSignals.push(BigInt(call.C1).toString());
    publicSignals.push(BigInt(call.C2).toString());

    publicSignals.push(BigInt(call.callValue).toString());

    return publicSignals;
}

// =====================================================================
// BUILD PUBLIC SIGNALS FOR NoidAccountOwnership proof
//
// Public signals order (matches NoidAccountOwnership circuit main):
//   commitment       — 1
//   callCommitment   — 1
//   nonce            — 1
//   target           — 1
//   value            — 1
//   dataHash         — 1
//                      = 6 total
// =====================================================================

function buildOwnershipPublicSignals({ commitment, callCommitment, nonce, target, value, dataHash }) {
    return [
        BigInt(commitment).toString(),
        BigInt(callCommitment).toString(),
        BigInt(nonce).toString(),
        BigInt(target).toString(),
        BigInt(value).toString(),
        BigInt(dataHash).toString(),
    ];
}

// =====================================================================
// CONVERT a raw snarkjs proof ({pi_a, pi_b, pi_c}) into solidity
// calldata tuples (a, b, c). This mirrors exactly what the test does
// with exportSolidityCallData — including the B-coordinate ordering
// that the on-chain verifier expects.
// =====================================================================

async function proofToSolidityCalldata(rawProof, publicSignals) {
    const calldata = await snarkjs.groth16.exportSolidityCallData(rawProof, publicSignals);
    const argv = calldata.replace(/["[\]\s]/g, "").split(",");

    const a = [argv[0], argv[1]];
    const b = [
        [argv[2], argv[3]],
        [argv[4], argv[5]],
    ];
    const c = [argv[6], argv[7]];

    return { a, b, c };
}

// =====================================================================
// CONTROLLER
// =====================================================================

async function executeFunctionController(req, res) {
    try {
        const {
            calls,            // ExecuteFunctionCall[] — already in on-chain shape (a,b,c,inputs,...)
            target,           // address — contract to call
            value,            // uint256 — total MON value (decimal string)
            data,             // bytes   — calldata
            commitment,       // bytes32 — noid account ownership commitment
            callCommitment,   // bytes32 — poseidon(cmx, nonce, actionHash)
            ownershipProof,   // RAW snarkjs proof { pi_a, pi_b, pi_c, protocol, curve }
            nonce,            // uint256 — noid account nonce at time of signing
            noidAccount,      // address — deployed NoidAccount contract
            zkProofs,         // RAW snarkjs proof[] for execute calls — one per call
            dataHash,         // string (decimal) — keccak256(data) mod field prime
        } = req.body;

        // ------------------------------------------------------------------
        // BASIC VALIDATION
        // ------------------------------------------------------------------

        if (!Array.isArray(calls) || calls.length === 0) {
            return res.status(400).json({ success: false, message: "calls must be a non-empty array" });
        }
        if (!Array.isArray(zkProofs) || zkProofs.length !== calls.length) {
            return res.status(400).json({ success: false, message: "zkProofs must be an array with one entry per call" });
        }
        if (!commitment || commitment === ZERO_COMMITMENT) {
            return res.status(400).json({ success: false, message: "commitment is required" });
        }
        if (!callCommitment || callCommitment === ZERO_COMMITMENT) {
            return res.status(400).json({ success: false, message: "callCommitment is required" });
        }
        // Expect RAW snarkjs proof shape now (pi_a/pi_b/pi_c)
        if (!ownershipProof || !ownershipProof.pi_a || !ownershipProof.pi_b || !ownershipProof.pi_c) {
            return res.status(400).json({ success: false, message: "ownershipProof (pi_a, pi_b, pi_c) is required" });
        }
        if (!noidAccount) {
            return res.status(400).json({ success: false, message: "noidAccount address is required" });
        }
        if (!target) {
            return res.status(400).json({ success: false, message: "target address is required" });
        }
        if (value === undefined || value === null) {
            return res.status(400).json({ success: false, message: "value is required" });
        }
        if (!data) {
            return res.status(400).json({ success: false, message: "data is required" });
        }
        if (!dataHash) {
            return res.status(400).json({ success: false, message: "dataHash is required" });
        }

        // ------------------------------------------------------------------
        // VERIFY EXECUTE FUNCTION CALL ZK PROOFS (one per call)
        // zkProofs[i] must be the RAW snarkjs proof for verify()
        // ------------------------------------------------------------------

        for (let i = 0; i < calls.length; i++) {
            const proof   = zkProofs[i];
            const signals = buildExecuteCallPublicSignals(calls[i]);

            console.log(`[executeFunction] call ${i} public signals:`, signals);

            const verified = await snarkjs.groth16.verify(executeFunCallVKey, signals, proof);
            console.log(`[executeFunction] call ${i} verified:`, verified);

            if (!verified) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid execute-call ZK proof for call index ${i}`,
                });
            }
        }

        // ------------------------------------------------------------------
        // VERIFY NOID ACCOUNT OWNERSHIP PROOF (raw snarkjs proof)
        // ------------------------------------------------------------------

        const ownershipSignals = buildOwnershipPublicSignals({
            commitment,
            callCommitment,
            nonce,
            target:   BigInt(target).toString(),
            value:    BigInt(value).toString(),
            dataHash: BigInt(dataHash).toString(),
        });

        console.log("[executeFunction] ownership public signals:", ownershipSignals);

        const ownershipVerified = await snarkjs.groth16.verify(
            noidAccountOwnershipVKey,
            ownershipSignals,
            ownershipProof
        );

        console.log("[executeFunction] ownership verified:", ownershipVerified);

        if (!ownershipVerified) {
            return res.status(400).json({ success: false, message: "Invalid NoidAccount ownership proof" });
        }

        // ------------------------------------------------------------------
        // NULLIFIER CHECK
        // ------------------------------------------------------------------

        for (const call of calls) {
            for (const nullifier of call.inputs.nullifiers) {
                if (nullifier === ZERO_COMMITMENT) continue;
                const parsed = BigInt(nullifier).toString();
                if (spentNullifiers.has(parsed)) {
                    return res.status(400).json({ success: false, message: "Nullifier already spent" });
                }
            }
        }

        // ------------------------------------------------------------------
        // DECRYPT RELAYER NOTES — compute total relayer fee
        // ------------------------------------------------------------------

        let totalRelayerFee = 0n;
        for (const call of calls) {
            if (call.C2 === ZERO_COMMITMENT) continue;
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
                    message: "Invalid or undecryptable relayer encrypted note (encryptedNote2)",
                });
            }
        }
        console.log("[executeFunction] total relayer fee (wei):", totalRelayerFee.toString());

        // ------------------------------------------------------------------
        // CONVERT OWNERSHIP PROOF → SOLIDITY CALLDATA (a, b, c)
        // The contract's executeFunction takes a/b/c for the ownership proof.
        // We derive these from the raw proof exactly like the test does.
        // ------------------------------------------------------------------

        const { a: ownA, b: ownB, c: ownC } = await proofToSolidityCalldata(
            ownershipProof,
            ownershipSignals
        );

        // ------------------------------------------------------------------
        // ESTIMATE GAS
        // ------------------------------------------------------------------

        const noidAccountManager = getNoidAccountManager();

        const gasEstimate = await noidAccountManager
            .connect(wallet)
            .executeFunction
            .estimateGas(
                calls,
                target,
                BigInt(value),
                data,
                commitment,
                callCommitment,
                ownA,
                ownB,
                ownC,
                noidAccount
            );

        const feeData = await provider.provider.getFeeData();
        const gasPrice = feeData.gasPrice;
        if (!gasPrice) {
            return res.status(500).json({ success: false, message: "Unable to fetch gas price" });
        }

        const estimatedCost = gasEstimate * gasPrice;
        console.log(
            "[executeFunction] gas estimate:", gasEstimate.toString(),
            "| gas price:", gasPrice.toString(),
            "| estimated cost (wei):", estimatedCost.toString()
        );

        // ------------------------------------------------------------------
        // PROFITABILITY CHECK
        // ------------------------------------------------------------------

        if (totalRelayerFee < estimatedCost) {
            return res.status(400).json({
                success: false,
                message: "Relayer fee insufficient to cover gas",
                estimatedCost: estimatedCost.toString(),
                totalRelayerFee: totalRelayerFee.toString(),
            });
        }

        // ------------------------------------------------------------------
        // SUBMIT TRANSACTION
        // ------------------------------------------------------------------

        const tx = await noidAccountManager
            .connect(wallet)
            .executeFunction(
                calls,
                target,
                BigInt(value),
                data,
                commitment,
                callCommitment,
                ownA,
                ownB,
                ownC,
                noidAccount
            );

        console.log("[executeFunction] tx submitted:", tx.hash);

        const receipt = await tx.wait();
        console.log("[executeFunction] confirmed in block:", receipt.blockNumber);

        // ------------------------------------------------------------------
        // SUCCESS
        // ------------------------------------------------------------------

        return res.json({
            success: true,
            txHash: receipt.hash,
            gasUsed: receipt.gasUsed.toString(),
            totalRelayerFee: totalRelayerFee.toString(),
            estimatedCost: estimatedCost.toString(),
        });

    } catch (err) {
        console.error("[executeFunction] error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = { executeFunctionController };