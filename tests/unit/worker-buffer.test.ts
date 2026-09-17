import { describe, expect, it } from "vitest";
import type { Job } from "../../src/domain/entities/job.entity.js";
import { WorkerBuffer } from "../../src/presentation/worker-buffer.js";

describe("WorkerBuffer", () => {
    const createJob = (id: string): Job<string> => ({
        id,
        data: `payload-${id}`,
        status: "active",
        priority: 1,
        addedAt: new Date(),
        retryCount: 0,
        maxAttempts: 1,
    });

    it("should initialize slot and return null when slot is empty or uninitialized", () => {
        const buffer = new WorkerBuffer<string>();

        expect(buffer.getBufferedJob(99)).toBeNull();

        buffer.initSlot(0);
        expect(buffer.getBufferedJob(0)).toBeNull();
    });

    it("should return null when fillSlot is called with empty jobs array", () => {
        const buffer = new WorkerBuffer<string>();
        buffer.initSlot(0);

        const next = buffer.fillSlot(0, []);
        expect(next).toBeNull();
        expect(buffer.getBufferedJob(0)).toBeNull();
    });

    it("should fill slot, return first job immediately, and buffer remainder", () => {
        const buffer = new WorkerBuffer<string>();
        buffer.initSlot(0);

        const j1 = createJob("1");
        const j2 = createJob("2");
        const j3 = createJob("3");

        const first = buffer.fillSlot(0, [j1, j2, j3]);
        expect(first).toBe(j1);

        expect(buffer.getBufferedJob(0)).toBe(j2);
        expect(buffer.getBufferedJob(0)).toBe(j3);
        expect(buffer.getBufferedJob(0)).toBeNull();
    });

    it("should handle undefined job elements safely returning null", () => {
        const buffer = new WorkerBuffer<string>();
        buffer.initSlot(0);

        // Array with single undefined element triggers line 36 shift() ?? null
        const undefinedJob = undefined as unknown as Job<string>;
        const first = buffer.fillSlot(0, [undefinedJob]);
        expect(first).toBeNull();

        // Array with valid job followed by undefined element triggers line 20 getBufferedJob() ?? null
        const j1 = createJob("valid");
        buffer.fillSlot(0, [j1, undefinedJob]);
        expect(buffer.getBufferedJob(0)).toBeNull();
    });

    it("should acquire and release buffer lock", async () => {
        const buffer = new WorkerBuffer<string>();

        await buffer.acquireLock();
        buffer.releaseLock();

        // Lock can be acquired again immediately
        await expect(buffer.acquireLock()).resolves.toBeUndefined();
        buffer.releaseLock();
    });
});
