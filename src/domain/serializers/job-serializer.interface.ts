export interface IJobSerializer {
    serialize<T>(data: T): Uint8Array | Buffer | string;
    deserialize<T>(raw: Uint8Array | Buffer | string): T;
}
