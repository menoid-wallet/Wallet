/**
 * verifyDeployment.js
 *
 * Checks, at boot, that each configured EVM pool address actually hosts the
 * NoidPool this backend was built against.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pool addresses come from the environment, and the environment lives in a
 * different place from the code — a hosting dashboard, not the repository. So a
 * redeploy can ship new code against old addresses, and nothing complains: the
 * relayer starts, answers requests, broadcasts transactions perfectly well, and
 * silently fails to index a single one of them. A user's deposit confirms
 * on-chain and never appears as a balance.
 *
 * That happened. This is the check that would have caught it in the first log
 * line instead of after the funds went missing from the UI.
 *
 * The probe is `registrationOf`, which exists only on the current contract, so
 * it separates "wrong address entirely" from "right address, older contract".
 */
"use strict";

const { ethers } = require("ethers");
const providerModule = require("../config/provider");

const EVM_NETWORKS = ["monad", "sepolia", "base_sepolia"];
const PROBE_ABI = [
    "function registrationOf(address) view returns (bytes32, bytes)"
];

// any address; we only care whether the call is answerable
const ZERO = "0x0000000000000000000000000000000000000000";

async function verifyOne(network) {
    const address = providerModule.getPoolAddressForNetwork(network);
    if (!address) return { network, ok: false, address, reason: "no pool address configured" };

    let provider;
    try { provider = providerModule.getReadProviderForNetwork(network, 0); }
    catch (e) { return { network, ok: false, address, reason: `no provider: ${e.message}` }; }

    let code;
    try { code = await provider.getCode(address); }
    catch (e) { return { network, ok: null, address, reason: `RPC unreachable: ${e.message}` }; }

    if (!code || code === "0x") {
        return { network, ok: false, address, reason: "no contract deployed at this address" };
    }

    try {
        const pool = new ethers.Contract(address, PROBE_ABI, provider);
        await pool.registrationOf(ZERO);
        return { network, ok: true, address };
    } catch (e) {
        return {
            network, ok: false, address,
            reason:
                "contract here does not answer registrationOf(address) — this is an " +
                "OLDER NoidPool, not the one this backend expects"
        };
    }
}

/**
 * Probe every EVM network. Returns the results; logs loudly on any mismatch.
 *
 * An unreachable RPC is reported (ok: null) but never treated as a mismatch —
 * we refuse to start over a configuration error, not over a flaky endpoint.
 */
async function verifyEvmDeployments({ exitOnMismatch = false } = {}) {
    const results = await Promise.all(EVM_NETWORKS.map(verifyOne));
    const bad = results.filter((r) => r.ok === false);
    const unknown = results.filter((r) => r.ok === null);

    for (const r of results) {
        if (r.ok === true)  console.log(`  [deploy-check] ${r.network.padEnd(13)} ${r.address} OK`);
        if (r.ok === null)  console.warn(`  [deploy-check] ${r.network.padEnd(13)} ${r.address} — ${r.reason}`);
        if (r.ok === false) console.error(`  [deploy-check] ${r.network.padEnd(13)} ${r.address} — ${r.reason}`);
    }

    if (bad.length) {
        console.error(
            "\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n" +
            `!! ${bad.length} pool address(es) are wrong for this build.\n` +
            "!! The relayer would still broadcast transactions and still answer\n" +
            "!! success — but it would index NOTHING, and deposits would confirm\n" +
            "!! on-chain without ever showing as a balance.\n" +
            `!! Fix: ${bad.map((b) => `${b.network.toUpperCase()}_PRIVATE_POOL_ADDRESS`).join(", ")}\n` +
            "!! Addresses of record: menoid/deploy.txt\n" +
            "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n"
        );
        if (exitOnMismatch) process.exit(1);
    }
    if (unknown.length) {
        console.warn(`  [deploy-check] ${unknown.length} network(s) could not be probed; continuing.`);
    }

    return results;
}

/* ─── Solana / Sui / Aptos ──────────────────────────────────────────────────
   These index from the request rather than from chain events, so a stale id
   makes transactions fail instead of vanish — louder, but still a deployment
   mistake the first log line should name. Each probe asks for something only
   the CURRENT deployment has. */

async function verifySui() {
    const { suiClient, packageId, poolStateId } = require("../config/suiProvider");
    const obj = await suiClient.getObject({ id: poolStateId, options: { showType: true, showContent: true } });
    const type = obj.data?.type || "";
    if (!type) return { network: "sui", ok: false, address: poolStateId, reason: "PoolState object not found" };
    if (!type.startsWith(`${packageId}::pool::PoolState`)) {
        return { network: "sui", ok: false, address: poolStateId,
                 reason: `object belongs to ${type.split("::")[0]}, not SUI_PACKAGE_ID ${packageId}` };
    }
    if (!obj.data?.content?.fields?.encryption_keys) {
        return { network: "sui", ok: false, address: poolStateId, reason: "PoolState has no encryption_keys — an older package" };
    }
    return { network: "sui", ok: true, address: poolStateId };
}

async function verifyAptos() {
    const { aptos, moduleAddr, poolAddr } = require("../config/aptosProvider");
    try {
        await aptos.view({ payload: {
            function: `${moduleAddr}::pool::registration_of`,
            typeArguments: [],
            functionArguments: [poolAddr, "0x1"]
        } });
        return { network: "aptos", ok: true, address: moduleAddr };
    } catch (e) {
        return { network: "aptos", ok: false, address: moduleAddr,
                 reason: `pool::registration_of not callable — wrong APTOS_MODULE_ADDR/POOL_ADDR or an older module (${(e.message || "").slice(0, 80)})` };
    }
}

async function verifySolana() {
    const { connection, program, programId, poolStatePda } = require("../config/solanaProvider");
    const info = await connection.getAccountInfo(poolStatePda);
    if (!info) return { network: "solana", ok: false, address: poolStatePda.toBase58(), reason: "pool state account does not exist" };
    if (!info.owner.equals(programId)) {
        return { network: "solana", ok: false, address: poolStatePda.toBase58(),
                 reason: `account is owned by ${info.owner.toBase58()}, not SOLANA_PROGRAM_ID` };
    }
    try { await program.account.poolState.fetch(poolStatePda); }
    catch (e) { return { network: "solana", ok: false, address: poolStatePda.toBase58(), reason: `does not decode as PoolState: ${e.message}` }; }
    return { network: "solana", ok: true, address: poolStatePda.toBase58() };
}

async function verifyOtherDeployments() {
    const probes = [["sui", verifySui], ["aptos", verifyAptos], ["solana", verifySolana]];
    const results = [];
    for (const [network, probe] of probes) {
        try { results.push(await probe()); }
        catch (e) { results.push({ network, ok: null, reason: `could not probe: ${e.message}` }); }
    }
    for (const r of results) {
        if (r.ok === true)  console.log(`  [deploy-check] ${r.network.padEnd(13)} ${r.address} OK`);
        if (r.ok === null)  console.warn(`  [deploy-check] ${r.network.padEnd(13)} — ${r.reason}`);
        if (r.ok === false) console.error(`  [deploy-check] ${r.network.padEnd(13)} ${r.address} — ${r.reason}`);
    }
    const bad = results.filter((r) => r.ok === false);
    if (bad.length) {
        console.error(`\n!! ${bad.length} non-EVM deployment id(s) are wrong for this build: ${bad.map((b) => b.network).join(", ")}` +
                      "\n!! Addresses of record: menoid/deploy.txt\n");
    }
    return results;
}

module.exports = { verifyEvmDeployments, verifyOtherDeployments, verifyOne, EVM_NETWORKS };
