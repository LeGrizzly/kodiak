import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Redis } from "ioredis";

jest.unstable_mockModule("fs", () => ({
    readFileSync: jest.fn().mockReturnValue("return 1"),
    default: { readFileSync: jest.fn().mockReturnValue("return 1") },
}));

const { DragonflyQueueRepository } = await import(
    "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js"
);

describe("DragonflyQueueRepository extra coverage", () => {
    let mockRedis: Partial<Redis> & { pipeline: jest.Mock };
    let mockPipeline: {
        hset: jest.Mock;
        hgetall: jest.Mock;
        hdel: jest.Mock;
        exec: jest.Mock;
    };
    let repo: InstanceType<typeof DragonflyQueueRepository>;

    beforeEach(() => {
        mockPipeline = {
            hset: jest.fn().mockReturnThis(),
            hgetall: jest.fn().mockReturnThis(),
            hdel: jest.fn().mockReturnThis(),
            exec: jest.fn(),
        };

        mockRedis = {
            eval: jest.fn(),
            pipeline: jest.fn().mockReturnValue(mockPipeline),
        } as unknown as Partial<Redis> & { pipeline: jest.Mock };

        repo = new DragonflyQueueRepository("q", mockRedis as unknown as Redis, "pref");
        jest.clearAllMocks();
    });

    it("fetchNextJobs should call hset without lock_owner when ownerToken not provided", async () => {
        const jobIds = ["job-1"];
        const jobData = {
            data: JSON.stringify({ foo: "bar" }),
            priority: "1",
            retry_count: "0",
            max_attempts: "1",
            added_at: String(Date.now()),
            state: "active",
        };

        (mockRedis.eval as jest.Mock).mockResolvedValue(jobIds as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [null, jobData],
        ] as never);

        const jobs = await repo.fetchNextJobs(1, 1000);

        expect(jobs).toHaveLength(1);
        // hset should have been called without lock_owner arg (i.e., 4 args after key)
        expect(mockPipeline.hset).toHaveBeenCalled();
        const hsetArgs = (mockPipeline.hset as jest.Mock).mock.calls[0] as unknown[];
        // args: jobKey, 'state', 'active', 'started_at', now
        expect(hsetArgs.length).toBeGreaterThanOrEqual(5);
        expect(hsetArgs).not.toContain("lock_owner");
    });

    it("extendLock returns true/false and forwards ownerToken correctly", async () => {
        (mockRedis.eval as jest.Mock)
            .mockResolvedValueOnce(1 as never)
            .mockResolvedValueOnce(0 as never);

        const res1 = await repo.extendLock("job-1", Date.now() + 1000, "owner-1");
        expect(res1).toBe(true);
        const call1 = (mockRedis.eval as jest.Mock).mock.calls[0] as unknown[];
        // last argument should be owner token
        expect(call1?.[6]).toBe("owner-1");

        const res2 = await repo.extendLock("job-2", Date.now() + 1000);
        expect(res2).toBe(false);
        const call2 = (mockRedis.eval as jest.Mock).mock.calls[1] as unknown[];
        // when ownerToken omitted, last arg should be empty string
        expect(call2?.[6]).toBe("");
    });

    it("releaseJobs invokes release_jobs script with keys and jobIds", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(2 as never);

        await repo.releaseJobs(["j1", "j2"]);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            3,
            expect.stringContaining(":active"),
            expect.stringContaining(":waiting"),
            expect.stringContaining(":notify"),
            expect.any(String),
            "j1",
            "j2",
        );
    });

    it("auto-pipelining flushes multiple adds into a single pipeline", async () => {
        const pipelinedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 2, maxWaitMs: 0 },
        );

        const job1 = {
            id: "p1",
            data: { msg: "1" },
            priority: 10,
            status: "waiting" as const,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        };
        const job2 = {
            id: "p2",
            data: { msg: "2" },
            priority: 10,
            status: "waiting" as const,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        };

        const mockPipelineObj = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([
                [null, 1],
                [null, 1],
            ] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockPipelineObj);

        const p1 = pipelinedRepo.add(job1, 100, false);
        const p2 = pipelinedRepo.add(job2, 200, false);

        await Promise.all([p1, p2]);

        expect(mockRedis.pipeline).toHaveBeenCalled();
        expect(mockPipelineObj.exec).toHaveBeenCalled();
    });
});
