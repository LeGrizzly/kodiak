import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Job } from "../../src/domain/entities/job.entity.js";
import { DragonflyQueueRepository } from "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js";

describe("Unit: DragonflyQueueRepository Deduplication", () => {
    let repository: DragonflyQueueRepository<{ message: string }>;
    let mockRedis: Redis;
    let mockPipeline: Record<string, Mock>;

    beforeEach(() => {
        mockPipeline = {
            eval: vi.fn().mockReturnThis(),
            evalsha: vi.fn().mockReturnThis(),
            exec: vi.fn(),
        };

        mockRedis = {
            eval: vi.fn(),
            del: vi.fn(),
            pipeline: vi.fn().mockReturnValue(mockPipeline),
        } as unknown as Redis;

        repository = new DragonflyQueueRepository("test-queue", mockRedis, "kodiak-test");
        vi.clearAllMocks();
    });

    const createTestJob = (id = "job-1"): Job<{ message: string }> => ({
        id,
        data: { message: "hello" },
        status: "waiting",
        priority: 1,
        retryCount: 0,
        maxAttempts: 3,
        addedAt: new Date(),
    });

    it("should pass 5 keys including dedupKey and dedupTtl in args when deduplication is specified", async () => {
        const job = createTestJob("job-dedup-1");
        (mockRedis.eval as Mock).mockResolvedValue([1, "job-dedup-1"] as never);

        const result = await repository.add(job, 100, false, { id: "order-123", ttl: 45000 });

        expect(result).toEqual({ isDuplicate: false, jobId: "job-dedup-1" });
        const callArgs = (mockRedis.eval as Mock).mock.calls[0];
        if (!callArgs) throw new Error("Expected callArgs to be defined");
        expect(callArgs[1]).toBe(5);
        expect(callArgs[2]).toContain(":waiting");
        expect(callArgs[3]).toContain(":delayed");
        expect(callArgs[4]).toContain(`:jobs:${job.id}`);
        expect(callArgs[5]).toContain(":notify");
        expect(callArgs[6]).toContain(":dedup:order-123");
        expect(callArgs[7]).toBe(job.id);
        expect(callArgs[8]).toBe("100");
        expect(callArgs[9]).toBe("0");
        expect(callArgs[10]).toBe("45000");
    });

    it("should parse duplicate response [0, existingJobId] correctly", async () => {
        const job = createTestJob("job-dup");
        (mockRedis.eval as Mock).mockResolvedValue([0, "existing-order-job"] as never);

        const result = await repository.add(job, 100, false, { id: "order-123", ttl: 60000 });

        expect(result).toEqual({ isDuplicate: true, jobId: "existing-order-job" });
    });

    it("should handle string response from script fallback", async () => {
        const job = createTestJob("job-string-res");
        (mockRedis.eval as Mock).mockResolvedValue("job-string-res" as never);

        const result = await repository.add(job, 100, false);

        expect(result).toEqual({ isDuplicate: false, jobId: "job-string-res" });
    });

    it("should handle default ttl of 60000 when ttl is not specified", async () => {
        const job = createTestJob("job-default-ttl");
        (mockRedis.eval as Mock).mockResolvedValue([1, "job-default-ttl"] as never);

        await repository.add(job, 50, false, { id: "dedup-no-ttl", ttl: 0 });

        const callArgs = (mockRedis.eval as Mock).mock.calls[0];
        if (!callArgs) throw new Error("Expected callArgs to be defined");
        expect(callArgs[1]).toBe(5);
        expect(callArgs[6]).toContain(":dedup:dedup-no-ttl");
        expect(callArgs[7]).toBe("job-default-ttl");
        expect(callArgs[8]).toBe("50");
        expect(callArgs[9]).toBe("0");
        expect(callArgs[10]).toBe("0");
    });

    it("should pass isDelayed '1' when delayed job has deduplication", async () => {
        const job = createTestJob("job-delayed-dedup");
        (mockRedis.eval as Mock).mockResolvedValue([1, "job-delayed-dedup"] as never);

        const result = await repository.add(job, 5000, true, { id: "order-delayed", ttl: 30000 });

        expect(result).toEqual({ isDuplicate: false, jobId: "job-delayed-dedup" });
        const callArgs = (mockRedis.eval as Mock).mock.calls[0];
        if (!callArgs) throw new Error("Expected callArgs to be defined");
        expect(callArgs[9]).toBe("1");
    });

    it("should support deduplication in pipelined batch adds", async () => {
        const pipelinedRepo = new DragonflyQueueRepository<{ message: string }>(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            { maxBatch: 2, maxWaitMs: 50 },
        );

        (mockPipeline.exec as Mock).mockResolvedValue([
            [null, [1, "job-pipe-1"]],
            [null, [0, "existing-pipe-job"]],
        ] as never);

        const job1 = createTestJob("job-pipe-1");
        const job2 = createTestJob("job-pipe-2");

        const p1 = pipelinedRepo.add(job1, 10, true, { id: "key-1", ttl: 10000 });
        const p2 = pipelinedRepo.add(job2, 20, false, { id: "key-2", ttl: 10000 });

        const [r1, r2] = await Promise.all([p1, p2]);

        expect(r1).toEqual({ isDuplicate: false, jobId: "job-pipe-1" });
        expect(r2).toEqual({ isDuplicate: true, jobId: "existing-pipe-job" });
    });

    it("should delete deduplication key via deleteDeduplicationKey", async () => {
        (mockRedis.del as Mock).mockResolvedValue(1 as never);

        const deleted = await repository.deleteDeduplicationKey("order-to-delete");

        expect(deleted).toBe(true);
        expect(mockRedis.del).toHaveBeenCalledWith(
            expect.stringContaining(":dedup:order-to-delete"),
        );
    });

    it("should return false when deleteDeduplicationKey does not delete any key", async () => {
        (mockRedis.del as Mock).mockResolvedValue(0 as never);

        const deleted = await repository.deleteDeduplicationKey("unknown-key");

        expect(deleted).toBe(false);
    });
});
