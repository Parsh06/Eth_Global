export type fetchEncryptionKeyResponse = {
    data: {
        key: string | null;
    };
};
declare const _default: (cid: string, publicKey: string, signedMessage: string, dynamicData?: {}, shardCount?: number) => Promise<fetchEncryptionKeyResponse>;
export default _default;
