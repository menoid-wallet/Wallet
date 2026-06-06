const { ethers } = require("ethers");
const {
    wallet,
    sepoliaWallet,
    baseSepoliaWallet,
    getWalletForNetwork,
    getPoolAddressForNetwork
} = require("../config/provider");

require("dotenv").config();

const abi = require("../abis/NoidPool.json");

// ─── Per-chain contract instances ─────────────────────────────────────────────

const monadPrivatePool = new ethers.Contract(
    process.env.MONAD_PRIVATE_POOL_ADDRESS,
    abi,
    wallet
);

const sepoliaPrivatePool = new ethers.Contract(
    process.env.SEPOLIA_PRIVATE_POOL_ADDRESS,
    abi,
    sepoliaWallet
);

const baseSepoliaPrivatePool = new ethers.Contract(
    process.env.BASE_SEPOLIA_PRIVATE_POOL_ADDRESS,
    abi,
    baseSepoliaWallet
);

// ─── Factory helper ───────────────────────────────────────────────────────────

function getPrivatePoolForNetwork(network) {
    switch (network) {
        case "sepolia":     return sepoliaPrivatePool;
        case "base_sepolia": return baseSepoliaPrivatePool;
        case "monad":
        default:            return monadPrivatePool;
    }
}

// Keep the default export as monad pool for backward-compat (relayerWithdraw)
module.exports = monadPrivatePool;
module.exports.monadPrivatePool      = monadPrivatePool;
module.exports.sepoliaPrivatePool    = sepoliaPrivatePool;
module.exports.baseSepoliaPrivatePool = baseSepoliaPrivatePool;
module.exports.getPrivatePoolForNetwork = getPrivatePoolForNetwork;