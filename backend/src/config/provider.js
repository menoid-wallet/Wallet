const { ethers } =
    require("ethers");

const circomlibjs =
    require("circomlibjs");


const PoolState =
    require("../models/PoolState");

const NullifierState =
    require("../models/NullifierState");

const NoidAccountState =
    require("../models/NoidAccountState");



const {
    IncrementalMerkleTree
} = require("@zk-kit/incremental-merkle-tree");

const {
    decryptMessage
} = require("../helpers/crypto");

require("dotenv").config();

const provider = new ethers.JsonRpcProvider(
        process.env.RPC_URL
    );

const wallet =
    new ethers.Wallet(
        process.env.PRIVATE_KEY,
        provider
    );

const {
    generatePrivateWallet
} = require("../helpers/privateWallet");


let relayerWallet;

async function initializeRelayer() {

    relayerWallet = await generatePrivateWallet( 
            process.env.PRIVATE_KEY + "Menoid wallet" 
        );

}


async function buildWallet() {

    console.log(
        "\n========== BUILDING RELAYER WALLET =========="
    );

    const poseidon =
        await circomlibjs.buildPoseidon();

    const pools =
        await PoolState.find();

    const nullifierState =
        await NullifierState.findOne({
            key: "global"
        });

    const noidAccountState =
        await NoidAccountState.findOne({
            key: "global"
        });

    const spentNullifiers =
        new Set(
            nullifierState?.nullifiers || []
        );

    const walletState = {

        notes: [],

        noidAccounts: [],

        balance:
            ethers.parseEther("0"),

        pools: {}
    };

    for (
        const account
        of noidAccountState
            ?.noidAccounts || []
    ) {

        try {

            const decrypted =
                decryptMessage(

                    account.encryptedNote,

                    relayerWallet
                        .privateWallet
                        .privateKey
                );

            const parsed =
                JSON.parse(decrypted);

            walletState
                .noidAccounts
                .push({

                    noidAccountAddress:
                        account
                            .noidAccountAddress,

                    ownerCommitment:
                        account
                            .ownerCommitment,

                    randomness:
                        parsed.randomness
                });

        } catch (_) {

        }
    }

    for (const pool of pools) {

        const poolId =
            pool.poolId;

        const latestRoot =
            pool.latestRoot;

        const hash = (inputs) => {
            return BigInt(
                poseidon.F.toString(
                    poseidon(inputs)
                )
            );
        };

        const tree =
            new IncrementalMerkleTree(
                hash,
                20,
                BigInt(0),
                2
            );

        for (
            const commitment
            of pool.commitments
        ) {

            tree.insert(
                BigInt(commitment)
            );

            try {

                const encryptedNote =
                    pool.encryptedNotes.get(
                        commitment
                    );

                const decrypted =
                    decryptMessage(

                        encryptedNote,

                        relayerWallet
                            .privateWallet
                            .privateKey
                    );

                const parsed =
                    JSON.parse(decrypted);

                const nullifier =
                    ethers.zeroPadValue(
    
                        ethers.toBeHex(
    
                            BigInt(
                                poseidon.F.toString(
                                    poseidon([
                                        2,
                                        BigInt(commitment),
                                        BigInt(parsed.randomness),
                                        BigInt(relayerWallet
                                            .zk
                                            .secretKey
                                        ),
                                    ])
                                )
                            )
                        ),
    
                        32
                    );

                // const expectedNullifier =
                //     poseidon.F.toString(

                //         poseidon([

                //             2,

                //             BigInt(commitment),

                //             BigInt(parsed.randomness),

                //             BigInt(relayerWallet
                //                 .zk
                //                 .secretKey)
                //         ])
                //     );

                if (

                    spentNullifiers.has(
                        nullifier
                    )
                ) {

                    continue;
                }

                const leafIndex =
                    pool.leafToIndex.get(
                        commitment
                    );

                walletState.notes.push({

                    poolId,

                    commitment,

                    amount:
                        parsed.amount,

                    randomness:
                        parsed.randomness,

                    leafIndex,

                    root:
                        latestRoot
                });

                walletState.balance +=
                    BigInt(parsed.amount);

            } catch (_) {

            }
        }

        walletState.pools[poolId] = {

            tree,

            latestRoot
        };
    }

    console.log(
        "\n========== RELAYER WALLET =========="
    );

    console.log(
        "Balance:",
        walletState.balance.toString()
    );

    console.log(
        "Unspent notes:",
        walletState.notes
    );

    return walletState;
}

module.exports = {
    provider,
    wallet,

    buildWallet,

    initializeRelayer,

    get relayerWallet() {
        return relayerWallet;
    }
};