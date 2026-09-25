/**
 * register.controller.js
 *
 * On-chain wallet registration, relayed through the backend.
 *
 * The USER signs the register transaction client-side (register(user_commitment)
 * must be sent from the user's own wallet — the on-chain map is keyed by the
 * sender). The wallet extension posts the signed transaction here and the
 * backend broadcasts it, so the extension never needs its own RPC/indexer.
 *
 *   POST /api/register/:network         — submit a user-signed register tx
 *     evm networks body:  { signedTx }                (raw signed tx hex)
 *     solana body:        { serializedTx }            (hex serialized signed tx)
 *     sui body:           { txBytes, signature }      (base64 + base64)
 *     aptos body:         { signedTxn }               (hex BCS SignedTransaction)
 *
 *   GET  /api/register/:network/status/:address — on-chain registration check
 *     → { registered, userCommitment, encryptionPublicKey }
 *
 * Since the 2026-09-25 redeploy the encryption public key lives ON-CHAIN,
 * registered by the same register() call as the user commitment. Both halves of
 * a receiver's identity now come from one source, which is why the wallet reads
 * them itself and no longer needs this endpoint to decide whether a pasted
 * address is registered. It stays for diagnostics and for any client that has
 * no RPC of its own.
 */
"use strict";

const { ethers } = require("ethers");
const { PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");

const providerModule = require("../config/provider");
const { withRpcRetry, isTransientRpcError } = require("../helpers/rpcRetry");
const solanaProvider = require("../config/solanaProvider");
const suiProvider = require("../config/suiProvider");
const aptosProvider = require("../config/aptosProvider");
const NoidRegistration = require("../models/NoidRegistration");

const EVM_NETWORKS = new Set(["monad", "sepolia", "base_sepolia"]);
const ALL_NETWORKS = new Set([...EVM_NETWORKS, "solana", "sui", "aptos"]);

function badNetwork(res, network) {
    return res.status(400).json({
        success: false,
        message: `Unknown network "${network}". Valid values: monad, sepolia, base_sepolia, solana, sui, aptos`
    });
}

/**
 * Mirror the registration into Mongo.
 *
 * This used to be the ONLY copy of the encryption public key, which made every
 * private send depend on this write having happened — and a miss here read to
 * the sender as "this address never registered". The chain holds both values
 * now, so this is a convenience index (analytics, support lookups), never a
 * source of truth. Best-effort: a store failure must not fail a registration
 * whose transaction already landed.
 */
async function storeRegistration(network, req) {
    const { address, userCommitment, encryptionPublicKey } = req.body;
    if (!address || !userCommitment || !encryptionPublicKey) return;
    try {
        await NoidRegistration.findOneAndUpdate(
            { network, address: String(address).toLowerCase() },
            { network, address: String(address).toLowerCase(), userCommitment, encryptionPublicKey },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    } catch (e) {
        console.error(`[register][${network}] failed to store encryption key:`, e.message);
    }
}

// ─── Submit a user-signed register transaction ────────────────────────────────

async function registerController(req, res) {
    const network = req.params.network;
    if (!ALL_NETWORKS.has(network)) return badNetwork(res, network);

    try {
        if (EVM_NETWORKS.has(network)) {
            const { signedTx } = req.body;
            if (!signedTx) {
                return res.status(400).json({ success: false, message: "Missing signedTx" });
            }
            const provider = providerModule.getProviderForNetwork(network);
            console.log(`[register][${network}] broadcasting signed register tx...`);
            const txResponse = await provider.broadcastTransaction(signedTx);
            const receipt = await txResponse.wait();
            if (!receipt || receipt.status !== 1) {
                return res.status(400).json({
                    success: false,
                    message: "Register transaction reverted on-chain (already registered?)",
                    txHash: txResponse.hash
                });
            }
            await storeRegistration(network, req);
            return res.json({ success: true, network, txHash: receipt.hash });
        }

        if (network === "solana") {
            const { serializedTx } = req.body;
            if (!serializedTx) {
                return res.status(400).json({ success: false, message: "Missing serializedTx" });
            }
            const { Transaction } = require("@solana/web3.js");
            const tx = Transaction.from(Buffer.from(serializedTx, "hex"));

            // co-sign as fee payer when the relayer sponsors the registration
            const relayerIsFeePayer =
                tx.feePayer && tx.feePayer.equals(solanaProvider.relayerKeypair.publicKey);
            if (relayerIsFeePayer) {
                try { tx.partialSign(solanaProvider.relayerKeypair); } catch (_) { /* already signed */ }
            }

            console.log("[register][solana] submitting register tx...");
            const signature = await solanaProvider.connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: false,
                preflightCommitment: "confirmed"
            });
            await solanaProvider.connection.confirmTransaction(signature, "confirmed");
            await storeRegistration(network, req);
            return res.json({ success: true, network, txHash: signature });
        }

        if (network === "sui") {
            const { txBytes, signature } = req.body;
            if (!txBytes || !signature) {
                return res.status(400).json({ success: false, message: "Missing txBytes / signature" });
            }
            console.log("[register][sui] submitting register tx...");
            const result = await suiProvider.suiClient.executeTransactionBlock({
                transactionBlock: txBytes,
                signature: Array.isArray(signature) ? signature : [signature],
                options: { showEffects: true }
            });
            if (result.effects?.status.status !== "success") {
                return res.status(400).json({
                    success: false,
                    message: `Register failed: ${JSON.stringify(result.effects?.status)}`,
                    txHash: result.digest
                });
            }
            await suiProvider.suiClient.waitForTransaction({ digest: result.digest });
            await storeRegistration(network, req);
            return res.json({ success: true, network, txHash: result.digest });
        }

        if (network === "aptos") {
            const { signedTxn } = req.body;
            if (!signedTxn) {
                return res.status(400).json({ success: false, message: "Missing signedTxn" });
            }
            console.log("[register][aptos] submitting register tx...");
            const nodeUrl = process.env.APTOS_NODE_URL || "https://fullnode.testnet.aptoslabs.com/v1";
            const bcsBytes = Buffer.from(
                signedTxn.startsWith("0x") ? signedTxn.slice(2) : signedTxn,
                "hex"
            );
            const submitRes = await fetch(`${nodeUrl}/transactions`, {
                method: "POST",
                headers: { "Content-Type": "application/x.aptos.signed_transaction+bcs" },
                body: bcsBytes
            });
            const submitJson = await submitRes.json();
            if (!submitRes.ok) {
                return res.status(400).json({
                    success: false,
                    message: `Register failed: ${submitJson.message || JSON.stringify(submitJson)}`
                });
            }
            const receipt = await aptosProvider.aptos.waitForTransaction({
                transactionHash: submitJson.hash
            });
            if (!receipt.success) {
                return res.status(400).json({
                    success: false,
                    message: "Register transaction failed on-chain (already registered?)",
                    txHash: submitJson.hash
                });
            }
            await storeRegistration(network, req);
            return res.json({ success: true, network, txHash: submitJson.hash });
        }
    } catch (err) {
        console.error(`[register][${network}] error:`, err);
        return res.status(500).json({
            success: false,
            message: err.shortMessage || err.reason || err.message
        });
    }
}

// ─── On-chain registration status ─────────────────────────────────────────────

/**
 * One call for both halves of a registration. `registrationOf` returns
 * (bytes32(0), "0x") for an address that never registered — it does not revert,
 * so "not registered" stays distinguishable from "the node did not answer".
 */
const POOL_REGISTERED_ABI = [
    "function registrationOf(address) view returns (bytes32 userCommitment, bytes encryptionPublicKey)"
];

/**
 * True when a Sui dynamic-field lookup missed — the address simply has no entry
 * in the registered table. That is an ANSWER ("not registered"); every other
 * failure shape is the node not answering.
 */
function isSuiFieldMiss(err) {
    const text = JSON.stringify(err?.code ?? err?.tag ?? err?.message ?? err ?? "");
    return /dynamicFieldNotFound|notExists|deleted|ObjectNotFound/i.test(text);
}

async function registrationStatus(network, address) {
    if (EVM_NETWORKS.has(network)) {
        // Lowercase first: EVM addresses are case-insensitive, but ethers throws
        // "bad address checksum" on a mixed-case address that isn't valid EIP-55.
        // All-lowercase is always accepted and matches how we store the address.
        const addr = String(address).toLowerCase();
        const poolAddress = providerModule.getPoolAddressForNetwork(network);

        // Read through the rotating read providers, not the signer-bound pool:
        // a rate-limited endpoint answers with an ethers CALL_EXCEPTION that is
        // shaped like a revert, so the retry has to be able to move elsewhere.
        const res = await withRpcRetry(
            (attempt) => {
                const pool = new ethers.Contract(
                    poolAddress,
                    POOL_REGISTERED_ABI,
                    providerModule.getReadProviderForNetwork(network, attempt)
                );
                return pool.registrationOf(addr);
            },
            {
                attempts: providerModule.readProviderCount(network) + 3,
                label: `register:${network}`
            }
        );

        const uc = res[0];
        const registered = uc !== ethers.ZeroHash;
        if (!registered) {
            return { registered: false, userCommitment: null, encryptionPublicKey: null };
        }
        return {
            registered: true,
            userCommitment: BigInt(uc).toString(),
            // 65-byte uncompressed secp256k1 key, as the wallet stores it
            encryptionPublicKey: res[1] && res[1] !== "0x" ? res[1] : null
        };
    }

    if (network === "solana") {
        const [registrationPda] = PublicKey.findProgramAddressSync(
            // "registration_v2": the v1 layout had no encryption key and is 32
            // bytes too small to deserialize as the current Registration, so
            // Anchor throws reading past the end of a leftover v1 account.
            [Buffer.from("registration_v2"), new PublicKey(address).toBuffer()],
            solanaProvider.programId
        );
        // fetchNullable returns null ONLY when the PDA holds no account — the one
        // case that actually means "not registered". Everything else (RPC down,
        // rate limited, decode failure) throws, and must keep throwing: catching
        // it here is what turns a hiccup into a false "not registered".
        const registration = await withRpcRetry(
            () => solanaProvider.program.account.registration.fetchNullable(registrationPda),
            { label: "register:solana" }
        );
        if (!registration) {
            return { registered: false, userCommitment: null, encryptionPublicKey: null };
        }
        const uc = BigInt(
            "0x" + Buffer.from(registration.userCommitment).toString("hex")
        ).toString();
        return {
            registered: true,
            userCommitment: uc,
            encryptionPublicKey: bs58.encode(
                Buffer.from(registration.encryptionPublicKey)
            )
        };
    }

    if (network === "sui") {
        // PoolState carries two tables keyed by address:
        //   registered      : Table<address, u256>
        //   encryption_keys : Table<address, vector<u8>>
        // Both are read with a dynamic-field lookup on the table's object id.
        return withRpcRetry(async () => {
            const obj = await suiProvider.suiClient.getObject({
                id: suiProvider.poolStateId,
                options: { showContent: true }
            });
            const fields = obj.data?.content?.fields;
            const tableId = fields?.registered?.fields?.id?.id;
            const keysTableId = fields?.encryption_keys?.fields?.id?.id;
            if (!tableId) throw new Error("registered table not found in PoolState");

            const lookup = async (parentId) => {
                let entry;
                try {
                    entry = await suiProvider.suiClient.getDynamicFieldObject({
                        parentId,
                        name: { type: "address", value: address }
                    });
                } catch (err) {
                    // Some client versions raise the miss instead of returning it.
                    if (isSuiFieldMiss(err)) return undefined;
                    throw err;
                }
                const errCode = entry?.error?.code ?? entry?.error?.tag ?? entry?.error;
                if (errCode) {
                    if (isSuiFieldMiss(entry.error)) return undefined;
                    // Anything else is the node failing to answer — say so, don't
                    // hand back a "no" the sender would act on.
                    throw new Error(`Sui registry lookup failed: ${JSON.stringify(entry.error)}`);
                }
                return entry.data?.content?.fields?.value ?? undefined;
            };

            const value = await lookup(tableId);
            if (value === undefined || value === null) {
                return { registered: false, userCommitment: null, encryptionPublicKey: null };
            }

            const keyBytes = keysTableId ? await lookup(keysTableId) : undefined;
            return {
                registered: true,
                userCommitment: BigInt(value).toString(),
                // 32-byte ed25519 key; the wallet stores it base64-encoded
                encryptionPublicKey: Array.isArray(keyBytes)
                    ? Buffer.from(Uint8Array.from(keyBytes)).toString("base64")
                    : null
            };
        }, { label: "register:sui" });
    }

    if (network === "aptos") {
        // registration_of answers (false, 0, 0x) for an unregistered address
        // rather than aborting, so one view call covers both outcomes.
        const [isRegistered, uc, encKey] = await withRpcRetry(
            () => aptosProvider.aptos.view({
                payload: {
                    function: `${aptosProvider.moduleAddr}::pool::registration_of`,
                    typeArguments: [],
                    functionArguments: [aptosProvider.poolAddr, address]
                }
            }),
            { label: "register:aptos" }
        );
        if (!isRegistered) {
            return { registered: false, userCommitment: null, encryptionPublicKey: null };
        }
        return {
            registered: true,
            userCommitment: BigInt(uc).toString(),
            // 32-byte ed25519 key; the wallet stores it as 0x hex
            encryptionPublicKey: encKey && encKey !== "0x" ? encKey : null
        };
    }

    throw new Error(`Unknown network ${network}`);
}

/**
 * The off-chain record for this wallet, or null when there is none.
 *
 * Returns `{ record, failed }` rather than a bare record: "Mongo says no such
 * wallet" and "Mongo did not answer" lead to different replies, and collapsing
 * them is how a reachable registry starts reporting a registered wallet as
 * having no encryption key.
 */
async function findCachedRegistration(network, address) {
    try {
        const record = await NoidRegistration.findOne({
            network,
            address: String(address).toLowerCase()
        });
        return { record: record || null, failed: false };
    } catch (err) {
        console.error(`[register][status][${network}] registration store unreachable:`, err.message);
        return { record: null, failed: true };
    }
}

async function registerStatusController(req, res) {
    const { network, address } = req.params;
    if (!ALL_NETWORKS.has(network)) return badNetwork(res, network);
    if (!address) {
        return res.status(400).json({ success: false, message: "Missing address" });
    }

    const cached = await findCachedRegistration(network, address);

    let status;
    try {
        status = await registrationStatus(network, address);
    } catch (err) {
        console.error(`[register][status][${network}] chain read failed:`, err.shortMessage || err.message);

        // The chain could not be ASKED. That is not a "no" — and answering "no"
        // here is the one failure a privacy wallet must never produce, because a
        // sender acts on it by falling back to a public withdraw.
        //
        // The stored record is written only after that wallet's own register
        // transaction confirmed, so it is a verified copy of the on-chain value.
        // Prefer it over failing the whole lookup.
        if (cached.record) {
            console.warn(`[register][status][${network}] serving ${address} from the stored registration`);
            return res.json({
                success: true,
                network,
                address,
                registered: true,
                userCommitment: cached.record.userCommitment,
                encryptionPublicKey: cached.record.encryptionPublicKey,
                source: "cache"
            });
        }

        // Nothing to fall back on — say the registry is unreachable and let the
        // caller retry. Never "registered: false".
        return res.status(503).json({
            success: false,
            unavailable: true,
            message: `Couldn't reach the ${network} registry right now.`,
            detail: err.shortMessage || err.message
        });
    }

    // Chain answered, and it now carries the encryption key too — a Mongo
    // outage no longer has any bearing on the reply.
    if (
        status.registered &&
        cached.record &&
        cached.record.userCommitment !== status.userCommitment
    ) {
        // Chain wins. A mismatch means the record predates a redeploy or a
        // re-registration; log it loudly rather than serving a stale key.
        console.warn(
            `[register][status][${network}] stored commitment for ${address} is stale ` +
            `(db=${cached.record.userCommitment} chain=${status.userCommitment})`
        );
    }

    return res.json({
        success: true,
        network,
        address,
        ...status,
        // Only if the chain somehow has no key (a wallet registered before the
        // 2026-09-25 redeploy) does the mirrored copy get a look in.
        encryptionPublicKey:
            status.encryptionPublicKey ??
            (cached.record ? cached.record.encryptionPublicKey : null),
        source: "chain"
    });
}

module.exports = { registerController, registerStatusController, registrationStatus };
