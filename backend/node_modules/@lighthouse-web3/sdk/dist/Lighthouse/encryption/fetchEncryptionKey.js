"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const kavach_1 = require("@lighthouse-web3/kavach");
exports.default = async (cid, publicKey, signedMessage, dynamicData = {}, shardCount = 3) => {
    const { error, shards } = await (0, kavach_1.recoverShards)(publicKey, cid, signedMessage, shardCount, dynamicData);
    if (error) {
        throw error;
    }
    const { masterKey: key, error: recoverError } = await (0, kavach_1.recoverKey)(shards);
    if (recoverError) {
        throw recoverError;
    }
    return { data: { key: key } };
};
