const { ethers } =
    require("ethers");

const {
    wallet
} = require("../config/provider");

require("dotenv").config();

const abi =
    require("../abis/PrivatePool.json");

const privatePool =
    new ethers.Contract(

        process.env.PRIVATE_POOL_ADDRESS,

        abi,

        wallet
    );

module.exports =
    privatePool;