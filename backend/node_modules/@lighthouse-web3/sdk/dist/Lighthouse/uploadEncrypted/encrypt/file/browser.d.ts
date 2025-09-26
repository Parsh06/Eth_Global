import { IFileUploadedResponse, IUploadProgressCallback } from '../../../../types';
declare const _default: (files: any, apiKey: string, publicKey: string, auth_token: string, uploadProgressCallback: (data: IUploadProgressCallback) => void) => Promise<{
    data: IFileUploadedResponse[];
}>;
export default _default;
