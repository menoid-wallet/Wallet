/**
 * mutex.js
 *
 * Simple queue-based lock mechanism to serialize operations on Solana, Sui, and Aptos.
 */
"use strict";

class Mutex {
    constructor() {
        this.queue = Promise.resolve();
    }

    /**
     * Runs an async function sequentially after all previously queued functions finish.
     * @param {Function} fn - Async function to run
     * @returns {Promise<any>} Resolves with the result of fn
     */
    run(fn) {
        const next = this.queue.then(() => fn());
        // Catch errors to ensure the queue is not permanently blocked
        this.queue = next.catch(() => {});
        return next;
    }
}

// Global mutex instances per network
const solanaMutex = new Mutex();
const suiMutex    = new Mutex();
const aptosMutex  = new Mutex();

module.exports = {
    solanaMutex,
    suiMutex,
    aptosMutex
};
