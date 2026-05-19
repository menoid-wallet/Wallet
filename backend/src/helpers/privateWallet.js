const { ethers } =
    require("ethers");

const circomlibjs =
    require("circomlibjs");

async function generatePrivateWallet(
    seedInput
) {

    const poseidon =
        await circomlibjs.buildPoseidon();

    // deterministic seed
    const seed = ethers.keccak256( ethers.toUtf8Bytes( seedInput ) );

    // derived private wallet
    const privateWallet =
        new ethers.Wallet(seed);

    // zk secret key
    const sk =
        BigInt(
            privateWallet.privateKey
        ).toString();

    // zk public key
    const pk =
        poseidon.F.toString(
            poseidon([3, sk])
        );

    return {

        privateWallet: {

            address:
                privateWallet.address,

            privateKey:
                privateWallet.privateKey,

            publicKey:
                ethers.SigningKey.computePublicKey(
                    privateWallet.privateKey,
                    false
                )
        },

        zk: {

            secretKey: sk,

            publicKey: pk
        }
    };
}

module.exports = {
    generatePrivateWallet
};