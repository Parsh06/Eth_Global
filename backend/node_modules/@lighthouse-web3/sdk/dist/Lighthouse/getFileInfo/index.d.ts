export type fileInfoType = {
    data: {
        fileSizeInBytes: string;
        cid: string;
        encryption: boolean;
        fileName: string;
        mimeType: string;
    };
};
declare const _default: (cid: string) => Promise<fileInfoType>;
export default _default;
