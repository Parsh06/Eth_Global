"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = __importDefault(require("./node"));
const web_1 = __importDefault(require("./web"));
exports.default = async (pathOrSize, network, token) => {
    // Upload File to IPFS
    //@ts-ignore
    if (typeof window === "undefined") {
        return await (0, node_1.default)(pathOrSize, network, token);
    }
    else {
        return await (0, web_1.default)(pathOrSize, network, token);
    }
};
