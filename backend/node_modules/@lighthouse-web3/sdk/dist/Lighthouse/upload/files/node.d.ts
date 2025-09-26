import { UploadFileReturnType, DealParameters } from '../../../types';
export declare function walk(dir: string): Promise<string[]>;
declare const _default: <T extends boolean>(sourcePath: string, apiKey: string, multi: boolean, dealParameters: DealParameters | undefined) => Promise<{
    data: UploadFileReturnType<T>;
}>;
export default _default;
