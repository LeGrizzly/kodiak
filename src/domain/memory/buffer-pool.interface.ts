export interface BufferPoolStats {
    totalAllocatedBytes: number;
    inUseBytes: number;
    freeBuffersCount: number;
    inUseBuffersCount: number;
}

export interface IBufferPool {
    acquire(minSize?: number): Uint8Array;
    release(buffer: Uint8Array): void;
    stats(): BufferPoolStats;
    clear(): void;
}
