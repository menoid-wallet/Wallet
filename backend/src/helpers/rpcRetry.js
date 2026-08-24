/**
 * rpcRetry.js
 *
 * Transient-RPC-failure handling for read calls.
 *
 * Public testnet RPCs answer "no" and "I can't answer right now" through the
 * same door. Monad's public endpoint caps at 15 requests/sec and replies
 *
 *     {"error":{"code":-32011,"message":"requests limited to 15/sec"}}
 *
 * which ethers v6 translates into a CALL_EXCEPTION reading `missing revert
 * data` — indistinguishable, at the call site, from a contract that reverted.
 * A registration check that trusts that answer either blocks a perfectly good
 * send or (worse) reports a registered wallet as unregistered.
 *
 * So: classify the error, retry the retryable ones with backoff + jitter, and
 * rotate across endpoints so one endpoint's rate limit is not the whole budget.
 */
"use strict";

/** Errors that mean "ask again", not "the answer is no". */
const TRANSIENT_PATTERNS = [
    /requests? limited/i,          // Monad: "requests limited to 15/sec"
    /rate.?limit/i,
    /too many requests/i,
    /missing revert data/i,        // ethers' rendering of a non-revert call failure
    /could not coalesce/i,         // ethers: unrecognised JSON-RPC error body
    /timeout|timed out|ETIMEDOUT/i,
    /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up/i,
    /fetch failed|network error/i,
    /bad response|server error|service unavailable|bad gateway/i,
    /502|503|504|429/
];

/** JSON-RPC error codes that are transport/limit problems, not answers. */
const TRANSIENT_CODES = new Set([-32005, -32011, -32603, -32000]);

function isTransientRpcError(err) {
    if (!err) return false;

    // A CALL_EXCEPTION with no returned data never came from a revert — a real
    // revert carries data (or at least a reason). `data: null` means the node
    // refused the call.
    if (err.code === "CALL_EXCEPTION" && (err.data === null || err.data === undefined)) return true;
    if (err.code === "SERVER_ERROR" || err.code === "TIMEOUT" || err.code === "NETWORK_ERROR") return true;
    if (err.code === "UNKNOWN_ERROR") return true;

    const rpcCode = err?.error?.code ?? err?.info?.error?.code;
    if (typeof rpcCode === "number" && TRANSIENT_CODES.has(rpcCode)) return true;

    const text = [
        err.shortMessage,
        err.message,
        err?.error?.message,
        err?.info?.error?.message
    ].filter(Boolean).join(" | ");

    return TRANSIENT_PATTERNS.some((re) => re.test(text));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A stalled socket that never rejects is a hang; give every attempt a deadline. */
function withDeadline(promise, ms, label) {
    if (!ms) return promise;
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`${label} timed out after ${ms}ms`);
            err.code = "TIMEOUT";
            reject(err);
        }, ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Run `attempt(i)` until it succeeds or the retries run out.
 *
 * The defaults are sized for a request a person is waiting on: a chain that is
 * entirely down costs about ten seconds before the caller is told so, rather
 * than a minute of spinner.
 *
 * `attempt` receives the attempt index so a caller can rotate endpoints. Only
 * transient failures are retried — a definitive error (bad address, unknown
 * network) is thrown straight back on the first try.
 */
async function withRpcRetry(
    attempt,
    { attempts = 3, baseDelayMs = 220, timeoutMs = 4000, label = "rpc" } = {}
) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
        try {
            return await withDeadline(
                Promise.resolve().then(() => attempt(i)),
                timeoutMs,
                label
            );
        } catch (err) {
            lastErr = err;
            if (!isTransientRpcError(err)) throw err;
            if (i === attempts - 1) break;
            // exponential backoff with jitter — several wallets hitting the same
            // shared rate limit must not retry in lockstep
            const delay = baseDelayMs * 2 ** i + Math.floor(Math.random() * 150);
            console.warn(
                `[${label}] transient RPC failure (attempt ${i + 1}/${attempts}), retrying in ${delay}ms:`,
                lastErr.shortMessage || lastErr.message
            );
            await sleep(delay);
        }
    }
    throw lastErr;
}

module.exports = { isTransientRpcError, withRpcRetry };
