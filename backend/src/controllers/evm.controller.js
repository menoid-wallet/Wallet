/**
 * evm.controller.js
 *
 * EVM deposit & withdraw.
 *
 *   deposit  — the user signs the transaction client-side (it carries the value
 *              the user is depositing) and posts the raw signed tx; the relayer
 *              broadcasts it.
 *   withdraw — the user posts the withdraw calls (each carrying its ZK proof) and
 *              the receiver; the RELAYER submits the transaction. This mirrors the
 *              EVM transfer route (and Solana/Sui/Aptos withdraw): the relayer is
 *              the on-chain sender — better privacy, no fragile re-broadcast of a
 *              user-signed tx — and it is compensated by the relayer fee note.
 *
 * After either confirms, the pools are updated locally + globally from the
 * receipt's events (NoteCreated / NullifierSpent), via applyReceiptEvents.
 */
"use strict";

const providerModule = require("../config/provider");
const { getPrivatePoolForNetwork } = require("../contracts/privatePool");
const { applyReceiptEvents } = require("../indexer/poolIndexer");

const VALID_NETWORKS = new Set(["monad", "sepolia", "base_sepolia"]);

function badNetwork(res, network) {
    return res.status(400).json({
        success: false,
        message: `Unknown network "${network}". Valid values: monad, sepolia, base_sepolia`
    });
}

// ─── Deposit: user-signed raw tx → relayer broadcasts ─────────────────────────

async function evmDepositController(req, res) {
    try {
        const network = req.params.network;
        if (!VALID_NETWORKS.has(network)) return badNetwork(res, network);

        const { signedTx } = req.body;
        if (!signedTx) {
            return res.status(400).json({ success: false, message: "Missing signedTx" });
        }

        const provider = providerModule.getProviderForNetwork(network);

        console.log(`[evm][deposit][${network}] broadcasting signed transaction...`);
        const txResponse = await provider.broadcastTransaction(signedTx);
        const receipt    = await txResponse.wait();

        if (!receipt || receipt.status !== 1) {
            return res.status(400).json({
                success: false,
                message: "Deposit transaction reverted on-chain",
                txHash:  txResponse.hash
            });
        }
        console.log(`[evm][deposit][${network}] confirmed: ${receipt.hash}`);

        const { latestRoots } = await applyReceiptEvents(network, receipt);
        return res.json({ success: true, network, txHash: receipt.hash, latestRoots });
    } catch (err) {
        console.error("[evm][deposit] error:", err);
        return res.status(500).json({
            success: false,
            message: err.shortMessage || err.reason || err.message
        });
    }
}

// ─── Withdraw: relayer-submitted (like transfer) ──────────────────────────────

async function evmWithdrawController(req, res) {
    try {
        const network = req.params.network;
        if (!VALID_NETWORKS.has(network)) return badNetwork(res, network);

        const { withdrawCalls, to } = req.body;
        if (!Array.isArray(withdrawCalls) || withdrawCalls.length === 0) {
            return res.status(400).json({ success: false, message: "withdrawCalls must be a non-empty array" });
        }
        if (!to) {
            return res.status(400).json({ success: false, message: "Missing receiver address 'to'" });
        }

        const privatePool   = getPrivatePoolForNetwork(network);
        const signingWallet  = providerModule.getWalletForNetwork(network);
        const poolWithSigner = privatePool.connect(signingWallet);

        // Simulate first: this reverts on an invalid proof, an already-spent
        // nullifier, or an insufficient pool balance — so the relayer never
        // submits (and pays gas for) a doomed transaction.
        await poolWithSigner.withdraw.estimateGas(withdrawCalls, to);

        console.log(`[evm][withdraw][${network}] submitting withdraw...`);
        const tx      = await poolWithSigner.withdraw(withdrawCalls, to);
        const receipt = await tx.wait();
        console.log(`[evm][withdraw][${network}] confirmed: ${receipt.hash}`);

        const { latestRoots } = await applyReceiptEvents(network, receipt);
        return res.json({ success: true, network, txHash: receipt.hash, latestRoots });
    } catch (err) {
        console.error("[evm][withdraw] error:", err);
        return res.status(500).json({
            success: false,
            message: err.shortMessage || err.reason || err.message
        });
    }
}

module.exports = { evmDepositController, evmWithdrawController };
