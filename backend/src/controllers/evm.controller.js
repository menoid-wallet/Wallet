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
const { applyReceiptEvents, PoolAddressMismatchError } = require("../indexer/poolIndexer");

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

        /* The transaction is mined by this point, so indexing is the only thing
           that can still go wrong — and if it does, the deposit exists on-chain
           with no note in the database to spend it from. That must never be
           reported as a success. */
        let latestRoots;
        try {
            ({ latestRoots } = await applyReceiptEvents(network, receipt));
        } catch (indexErr) {
            console.error(`[evm][deposit][${network}] INDEXING FAILED for ${receipt.hash}:`, indexErr.message);
            return res.status(500).json({
                success:  false,
                indexed:  false,
                onChain:  true,
                txHash:   receipt.hash,
                message:
                    "Your deposit is confirmed on-chain, but this relayer could not index it, " +
                    "so it will not show as a balance yet. No funds are lost. Report this tx hash.",
                detail:   indexErr.message
            });
        }

        /* A deposit always emits at least one NoteCreated. Zero means the
           receipt was parsed against the wrong contract, or the ABI has drifted
           from what is deployed — either way the note is not in the tree. */
        const noteCount = Object.keys(latestRoots || {}).length;
        if (noteCount === 0) {
            console.error(
                `[evm][deposit][${network}] ${receipt.hash} produced NO indexed notes ` +
                `(pool ${providerModule.getPoolAddressForNetwork(network)})`
            );
            return res.status(500).json({
                success:  false,
                indexed:  false,
                onChain:  true,
                txHash:   receipt.hash,
                message:
                    "Your deposit is confirmed on-chain, but this relayer indexed no note for it, " +
                    "so it will not show as a balance yet. No funds are lost. Report this tx hash.",
                detail:   "deposit receipt produced zero NoteCreated events"
            });
        }

        return res.json({ success: true, network, txHash: receipt.hash, latestRoots });
    } catch (err) {
        console.error("[evm][deposit] error:", err);
        const mismatch = err instanceof PoolAddressMismatchError;
        return res.status(500).json({
            success: false,
            ...(mismatch ? { indexed: false, onChain: true } : {}),
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
