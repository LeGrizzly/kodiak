import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Redis } from "ioredis";

jest.unstable_mockModule("fs", () => ({
    readFileSync: jest.fn().mockReturnValue("return 1"),
    default: {
        readFileSync: jest.fn().mockReturnValue("return 1"),
    },
}));

const { DragonflyQueueRepository } = await import(
    "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js"
);

type AnyAsyncMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
type AnySyncMock = jest.Mock<(...args: unknown[]) => unknown>;

describe("Unit: DragonflyQueueRepository DLQ", () => {
    let repository: InstanceType<typeof DragonflyQueueRepository>;
    let mockRedis: {
        eval: AnyAsyncMock;
        zcard: AnyAsyncMock;
        zrevrange: AnyAsyncMock;
        zrange: AnyAsyncMock;
        pipeline: AnySyncMock;
    };
    let mockPipeline: {
        hgetall: AnySyncMock;
        exec: AnyAsyncMock;
    };

    beforeEach(() => {
        mockPipeline = {
            hgetall: jest.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
            exec: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
        };

        mockRedis = {
            eval: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
            zcard: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
            zrevrange: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
            zrange: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
            pipeline: jest.fn<(...args: unknown[]) => unknown>().mockReturnValue(mockPipeline),
        };

        repository = new DragonflyQueueRepository(
            "dlq-test-queue",
            mockRedis as unknown as Redis,
            "kodiak-test",
        );
        jest.clearAllMocks();
    });

    it("should getFailedCount via zcard on deadKey", async () => {
        mockRedis.zcard.mockResolvedValue(7);

        const count = await repository.getFailedCount();

        expect(mockRedis.zcard).toHaveBeenCalledWith("{kodiak-test:dlq-test-queue}:dead");
        expect(count).toBe(7);
    });

    it("should return empty array from getFailedJobs when deadKey is empty", async () => {
        mockRedis.zrevrange.mockResolvedValue([]);

        const jobs = await repository.getFailedJobs(0, 10);

        expect(mockRedis.zrevrange).toHaveBeenCalledWith("{kodiak-test:dlq-test-queue}:dead", 0, 9);
        expect(jobs).toEqual([]);
    });

    it("should getFailedJobs with pagination and build strongly typed jobs", async () => {
        mockRedis.zrevrange.mockResolvedValue(["job-fail-1"]);
        mockPipeline.exec.mockResolvedValue([
            [
                null,
                {
                    data: JSON.stringify({ reason: "timeout" }),
                    state: "failed",
                    priority: "10",
                    retry_count: "3",
                    max_attempts: "3",
                    added_at: "1000",
                    failed_at: "2000",
                    error: "Fatal network error",
                    prev_error: "First retry error",
                    prev_failed_at: "1500",
                },
            ],
        ]);

        const jobs = await repository.getFailedJobs(0, 20);

        expect(mockRedis.zrevrange).toHaveBeenCalledWith(
            "{kodiak-test:dlq-test-queue}:dead",
            0,
            19,
        );
        expect(mockPipeline.hgetall).toHaveBeenCalledWith(
            "{kodiak-test:dlq-test-queue}:jobs:job-fail-1",
        );
        expect(jobs.length).toBe(1);
        expect(jobs[0]?.id).toBe("job-fail-1");
        expect(jobs[0]?.status).toBe("failed");
        expect(jobs[0]?.error).toBe("Fatal network error");
        expect(jobs[0]?.errorHistory?.[0]?.error).toBe("First retry error");
    });

    it("should retryJob via retry_failed_job script", async () => {
        mockRedis.eval.mockResolvedValue(1);

        const result = await repository.retryJob("job-retry-1");

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            4,
            "{kodiak-test:dlq-test-queue}:dead",
            "{kodiak-test:dlq-test-queue}:waiting",
            "{kodiak-test:dlq-test-queue}:notify",
            "{kodiak-test:dlq-test-queue}:jobs:job-retry-1",
            "job-retry-1",
            expect.any(String),
        );
        expect(result).toBe(true);
    });

    it("should return false if retryJob does not find job in DLQ", async () => {
        mockRedis.eval.mockResolvedValue(0);

        const result = await repository.retryJob("non-existent-job");

        expect(result).toBe(false);
    });

    it("should retryAllFailed by iterating over deadKey entries", async () => {
        mockRedis.zrange.mockResolvedValue(["job-1", "job-2", "job-3"]);
        mockRedis.eval.mockResolvedValue(1);

        const count = await repository.retryAllFailed(50);

        expect(mockRedis.zrange).toHaveBeenCalledWith("{kodiak-test:dlq-test-queue}:dead", 0, "49");
        expect(count).toBe(3);
    });

    it("should cleanFailed with olderThanMs cutoff", async () => {
        mockRedis.eval.mockResolvedValue(4);

        const cleaned = await repository.cleanFailed(3600000);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            1,
            "{kodiak-test:dlq-test-queue}:dead",
            expect.stringMatching(/^\d+$/),
            "{kodiak-test:dlq-test-queue}:jobs:",
            "500",
        );
        expect(cleaned).toBe(4);
    });

    it("should cleanFailed with all (+inf) when olderThanMs is 0", async () => {
        mockRedis.eval.mockResolvedValue(10);

        const cleaned = await repository.cleanFailed(0);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            1,
            "{kodiak-test:dlq-test-queue}:dead",
            "+inf",
            "{kodiak-test:dlq-test-queue}:jobs:",
            "500",
        );
        expect(cleaned).toBe(10);
    });

    it("should getFailedJobs with default arguments 0 and 20", async () => {
        mockRedis.zrevrange.mockResolvedValue([]);

        const jobs = await repository.getFailedJobs();

        expect(mockRedis.zrevrange).toHaveBeenCalledWith(
            "{kodiak-test:dlq-test-queue}:dead",
            0,
            19,
        );
        expect(jobs).toEqual([]);
    });

    it("should return empty array from getFailedJobs when zrevrange returns null", async () => {
        mockRedis.zrevrange.mockResolvedValue(null as never);

        const jobs = await repository.getFailedJobs(0, 10);

        expect(jobs).toEqual([]);
    });

    it("should return empty array from getFailedJobs when pipeline.exec returns null", async () => {
        mockRedis.zrevrange.mockResolvedValue(["job-1"]);
        mockPipeline.exec.mockResolvedValue(null);

        const jobs = await repository.getFailedJobs(0, 10);

        expect(jobs).toEqual([]);
    });

    it("should skip invalid entries or records in getFailedJobs results", async () => {
        mockRedis.zrevrange.mockResolvedValue(["job-1", "job-2", "job-3", "job-4", "job-5"]);
        mockPipeline.exec.mockResolvedValue([
            null, // !entry
            [new Error("pipeline error"), null], // has err
            [null, null], // !record
            [null, {}], // empty record -> buildJobFromRecord returns null
            [
                null,
                {
                    data: JSON.stringify({ ok: true }),
                    state: "failed",
                    priority: "0",
                    added_at: "1000",
                    failed_at: "2000",
                    error: "Test failure",
                },
            ],
        ]);

        const jobs = await repository.getFailedJobs(0, 10);

        expect(jobs).toHaveLength(1);
        expect(jobs[0]?.id).toBe("job-5");
    });

    it("should retryAllFailed with default limit 100", async () => {
        mockRedis.zrange.mockResolvedValue(["job-1"]);
        mockRedis.eval.mockResolvedValue(1);

        const count = await repository.retryAllFailed();

        expect(mockRedis.zrange).toHaveBeenCalledWith("{kodiak-test:dlq-test-queue}:dead", 0, "99");
        expect(count).toBe(1);
    });

    it("should return 0 from retryAllFailed when zrange returns null", async () => {
        mockRedis.zrange.mockResolvedValue(null as never);

        const count = await repository.retryAllFailed();

        expect(count).toBe(0);
    });

    it("should only increment retriedCount for successful retries in retryAllFailed", async () => {
        mockRedis.zrange.mockResolvedValue(["job-success", "job-failure"]);
        mockRedis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

        const count = await repository.retryAllFailed(10);

        expect(count).toBe(1);
    });

    it("should cleanFailed with default olderThanMs 0 (+inf)", async () => {
        mockRedis.eval.mockResolvedValue(5);

        const cleaned = await repository.cleanFailed();

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            1,
            "{kodiak-test:dlq-test-queue}:dead",
            "+inf",
            "{kodiak-test:dlq-test-queue}:jobs:",
            "500",
        );
        expect(cleaned).toBe(5);
    });

    it("should fallback to 0 in cleanFailed when eval returns null or NaN", async () => {
        mockRedis.eval.mockResolvedValue(null as never);

        const cleaned = await repository.cleanFailed(1000);

        expect(cleaned).toBe(0);
    });
});
