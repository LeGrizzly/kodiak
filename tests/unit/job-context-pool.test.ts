import { describe, expect, it, jest } from "@jest/globals";
import { JobContextPool } from "../../src/application/dtos/job-context-pool.js";
import type { Job } from "../../src/domain/entities/job.entity.js";

describe("JobContextPool", () => {
    it("should acquire and reuse a JobContext instance", () => {
        const pool = new JobContextPool<string>("test-queue");
        const job1: Job<string> = {
            id: "job-1",
            data: "payload-1",
            priority: 1,
            status: "active",
            retryCount: 0,
            maxAttempts: 3,
            addedAt: new Date(),
        };

        const ctx1 = pool.acquire(job1, "token-1");
        expect(ctx1.job.id).toBe("job-1");
        expect(ctx1.data).toBe("payload-1");
        expect(ctx1.logger).toBeDefined();

        pool.release(ctx1);

        const job2: Job<string> = {
            id: "job-2",
            data: "payload-2",
            priority: 2,
            status: "active",
            retryCount: 1,
            maxAttempts: 3,
            addedAt: new Date(),
        };

        const ctx2 = pool.acquire(job2, "token-2");
        // Must reuse the exact same object reference
        expect(ctx2).toBe(ctx1);
        // But fields must be updated
        expect(ctx2.job.id).toBe("job-2");
        expect(ctx2.data).toBe("payload-2");
    });

    it("should allocate distinct context instances under concurrency and recycle all", () => {
        const pool = new JobContextPool<number>("num-queue");

        const makeJob = (id: string, n: number): Job<number> => ({
            id,
            data: n,
            priority: 1,
            status: "active",
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        });

        const ctxA = pool.acquire(makeJob("jA", 10), "tokA");
        const ctxB = pool.acquire(makeJob("jB", 20), "tokB");

        expect(ctxA).not.toBe(ctxB);
        expect(ctxA.job.id).toBe("jA");
        expect(ctxB.job.id).toBe("jB");

        pool.release(ctxA);
        pool.release(ctxB);

        expect(pool.availableCount()).toBe(2);
    });

    it("should execute bound heartbeat and updateProgress callbacks", async () => {
        const mockHeartbeat = jest.fn().mockResolvedValue(true as never);
        const mockUpdateProgress = jest.fn().mockResolvedValue(undefined as never);

        const pool = new JobContextPool<string>("exec-queue", {
            heartbeatFactory: () => async (jobId: string, ownerToken?: string) =>
                mockHeartbeat(jobId, ownerToken) as Promise<boolean>,
            updateProgressFactory: () => async (jobId: string, progress: number) => {
                await mockUpdateProgress(jobId, progress);
            },
        });

        const job: Job<string> = {
            id: "job-exec",
            data: "exec-data",
            priority: 1,
            status: "active",
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        };

        const ctx = pool.acquire(job, "token-exec");
        await ctx.heartbeat?.();
        await ctx.updateProgress?.(50);

        expect(mockHeartbeat).toHaveBeenCalledWith(job.id, "token-exec");
        expect(mockUpdateProgress).toHaveBeenCalledWith(job.id, 50);
    });
});
