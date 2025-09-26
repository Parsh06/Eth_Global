"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* istanbul ignore file */
const axios_1 = __importDefault(require("axios"));
const ethers_1 = require("ethers");
const lighthouse_config_1 = require("../../../lighthouse.config");
const getTickerPrice = async (symbol) => {
    try {
        return (await axios_1.default.get(`${lighthouse_config_1.lighthouseConfig.lighthouseAPI}/api/lighthouse/get_ticker?symbol=${symbol}`)).data;
    }
    catch (error) {
        throw new Error(`Failed to get ticker price: ${error.message}`);
    }
};
const calculatePrice = async (size, network, token) => {
    const minFileSizeInBytes = 1048576; // 1MB
    const chargeableSizeInMB = Math.max(size, minFileSizeInBytes) / 1048576;
    const dollarPricePerMB = 0.00390625;
    const cost = dollarPricePerMB * chargeableSizeInMB;
    if (token === 'usdc' || token === 'usdt' || token === 'dai') {
        const decimals = lighthouse_config_1.lighthouseConfig[network][`${token}_contract_decimal`];
        const priceTODecimals = cost.toFixed(decimals);
        const priceInSmallestUnits = ethers_1.ethers.parseUnits(priceTODecimals.toString(), decimals);
        return priceInSmallestUnits;
    }
    const tokenPriceInUSD = await getTickerPrice(lighthouse_config_1.lighthouseConfig[network]['symbol']);
    const priceInToken = cost / tokenPriceInUSD;
    const priceToDecimals = priceInToken.toFixed(lighthouse_config_1.lighthouseConfig[network].native_decimal);
    const priceInSmallestUnits = ethers_1.ethers.parseUnits(priceToDecimals.toString(), lighthouse_config_1.lighthouseConfig[network].native_decimal);
    return priceInSmallestUnits;
};
exports.default = async (pathOrSize, network, token) => {
    try {
        if (!network) {
            throw new Error("Token not provided!!!");
        }
        if (typeof pathOrSize === 'number') {
            const price = calculatePrice(pathOrSize, network.toLowerCase(), token?.toLowerCase());
            return price;
        }
        else {
            let totalSize = 0;
            for (let i = 0; i < pathOrSize.length; i++) {
                totalSize = totalSize + pathOrSize[i]['size'];
            }
            const price = calculatePrice(totalSize, network.toLowerCase(), token?.toLowerCase());
            return price;
        }
    }
    catch (error) {
        throw new Error(error.message);
    }
};
