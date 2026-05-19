const {
    encrypt,
    decrypt
} = require("eciesjs");

const {
    getBytes,
    hexlify,
    toUtf8Bytes,
    toUtf8String
} = require("ethers");


// encrypt plaintext using public key
function encryptMessage(
    message,
    publicKey
) {

    const messageBytes =
        toUtf8Bytes(message);

    const publicKeyBytes =
        getBytes(publicKey);

    const encrypted =
        encrypt(
            publicKeyBytes,
            messageBytes
        );

    return hexlify(encrypted);
}


// decrypt ciphertext using private key
function decryptMessage(
    ciphertextHex,
    privateKey
) {

    const ciphertextBytes =
        getBytes(ciphertextHex);

    const privateKeyBytes =
        getBytes(privateKey);

    const decrypted =
        decrypt(
            privateKeyBytes,
            ciphertextBytes
        );

    return toUtf8String(decrypted);
}

module.exports = {

    encryptMessage,

    decryptMessage
};