import type { BufferPoolStats, IBufferPool } from "../../domain/memory/buffer-pool.interface.js";

export class SlabBufferPool implements IBufferPool {
    private static readonly SLAB_SIZES = [1024, 4096, 16384, 65536];

    private readonly freePools = new Map<number, Uint8Array[]>();
    private readonly inUseBuffers = new Set<Uint8Array>();
    private totalAllocatedBytes = 0;
    private inUseBytes = 0;

    constructor() {
        for (const size of SlabBufferPool.SLAB_SIZES) {
            this.freePools.set(size, []);
        }
    }

    public acquire(minSize: number = 1024): Uint8Array {
        const targetSize = this.resolveSlabSize(minSize);
        const freeList = this.freePools.get(targetSize);

        let buffer: Uint8Array;
        if (freeList && freeList.length > 0) {
            buffer = freeList.pop() as Uint8Array;
        } else {
            buffer = new Uint8Array(targetSize);
            this.totalAllocatedBytes += targetSize;
        }

        this.inUseBuffers.add(buffer);
        this.inUseBytes += buffer.length;

        return buffer;
    }

    public release(buffer: Uint8Array): void {
        if (!this.inUseBuffers.has(buffer)) {
            return;
        }

        this.inUseBuffers.delete(buffer);
        this.inUseBytes -= buffer.length;

        // Reset buffer bytes to zero to avoid data leakage
        buffer.fill(0);

        const freeList = this.freePools.get(buffer.length);
        if (freeList) {
            freeList.push(buffer);
        } else {
            // Buffer was an oversized non-slab allocation, allow GC to reclaim it
            this.totalAllocatedBytes -= buffer.length;
        }
    }

    public stats(): BufferPoolStats {
        let freeBuffersCount = 0;
        for (const list of this.freePools.values()) {
            freeBuffersCount += list.length;
        }

        return {
            totalAllocatedBytes: this.totalAllocatedBytes,
            inUseBytes: this.inUseBytes,
            freeBuffersCount,
            inUseBuffersCount: this.inUseBuffers.size,
        };
    }

    public clear(): void {
        for (const list of this.freePools.values()) {
            list.length = 0;
        }
        this.inUseBuffers.clear();
        this.totalAllocatedBytes = 0;
        this.inUseBytes = 0;
    }

    private resolveSlabSize(minSize: number): number {
        for (const size of SlabBufferPool.SLAB_SIZES) {
            if (size >= minSize) return size;
        }
        return minSize;
    }
}
