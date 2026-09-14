import { describe, expect, it } from "@jest/globals";
import { SlabBufferPool } from "../../src/infrastructure/memory/slab-buffer-pool.js";

describe("SlabBufferPool", () => {
    it("should acquire and release a buffer in standard slab sizes", () => {
        const pool = new SlabBufferPool();

        const buf1 = pool.acquire(500); // Should select 1KB slab (1024)
        expect(buf1.length).toBe(1024);

        const stats1 = pool.stats();
        expect(stats1.inUseBuffersCount).toBe(1);
        expect(stats1.inUseBytes).toBe(1024);

        pool.release(buf1);
        const stats2 = pool.stats();
        expect(stats2.inUseBuffersCount).toBe(0);
        expect(stats2.freeBuffersCount).toBe(1);

        // Re-acquire should reuse the exact same buffer instance
        const buf2 = pool.acquire(800);
        expect(buf2).toBe(buf1);
        expect(pool.stats().inUseBuffersCount).toBe(1);
        expect(pool.stats().freeBuffersCount).toBe(0);
    });

    it("should pick the right slab class for different buffer sizes", () => {
        const pool = new SlabBufferPool();

        const buf1k = pool.acquire(100);
        expect(buf1k.length).toBe(1024);

        const buf4k = pool.acquire(2000);
        expect(buf4k.length).toBe(4096);

        const buf16k = pool.acquire(10000);
        expect(buf16k.length).toBe(16384);

        const buf64k = pool.acquire(30000);
        expect(buf64k.length).toBe(65536);

        // Larger than 64KB should allocate exact size
        const bufLarge = pool.acquire(100000);
        expect(bufLarge.length).toBe(100000);
    });

    it("should clear the pool cleanly", () => {
        const pool = new SlabBufferPool();

        const buf = pool.acquire(1024);
        pool.release(buf);
        expect(pool.stats().freeBuffersCount).toBe(1);

        pool.clear();
        expect(pool.stats().freeBuffersCount).toBe(0);
        expect(pool.stats().totalAllocatedBytes).toBe(0);
    });
});
