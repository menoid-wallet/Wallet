/**
 * migrate_add_network.js
 *
 * One-time migration: stamps network = "monad" on every existing document
 * that was created before the multi-chain refactor.
 *
 * Run ONCE before starting the updated server:
 *   node migrate_add_network.js
 *
 * The script is idempotent — documents that already have a network value
 * are left untouched (updateMany with $exists: false guard).
 */

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");

// ─── Raw collection names (mongoose pluralises model names) ──────────────────
// PoolState      → poolstates
// NoteState      → notestates
// NullifierState → nullifierstates


async function run() {
    console.log("Connecting to MongoDB…");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected.\n");

    const db = mongoose.connection.db;

    const collections = [
        { name: "poolstates",        label: "PoolState" },
        { name: "notestates",        label: "NoteState" },
        { name: "nullifierstates",   label: "NullifierState" }
    ];

    for (const { name, label } of collections) {
        const col = db.collection(name);

        // 1. Stamp network = "monad" on all docs that don't have it yet
        const result = await col.updateMany(
            { network: { $exists: false } },
            { $set: { network: "monad" } }
        );
        console.log(
            `${label}: ${result.modifiedCount} document(s) updated → network = "monad"`
        );

        // 2. For PoolState the unique index is now (network, poolId).
        //    Drop the old single-field unique index on poolId if it exists so
        //    Mongoose can create the new compound one cleanly on next startup.
        if (name === "poolstates") {
            try {
                await col.dropIndex("poolId_1");
                console.log(`  PoolState: dropped old unique index on poolId`);
            } catch (e) {
                // Index may not exist (already dropped or never created by name)
                console.log(`  PoolState: old poolId_1 index not found (ok) — ${e.message}`);
            }
        }

        // 3. NoteState / NullifierState / NoidAccountState had a unique index
        //    on "key" alone.  Drop those so the new (network, key) compound
        //    index can be created without conflicts.
        if (["notestates", "nullifierstates"].includes(name)) {
            try {
                await col.dropIndex("key_1");
                console.log(`  ${label}: dropped old unique index on key`);
            } catch (e) {
                console.log(`  ${label}: old key_1 index not found (ok) — ${e.message}`);
            }
        }
    }

    console.log("\nMigration complete. You can now start the updated server.");
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});