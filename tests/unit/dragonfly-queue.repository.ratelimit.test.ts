import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Redis } from "ioredis";
import type { RateLimiterOptions } from "../../src/application/dtos/rate-limiter-options.dto.js";

jest.unstable_mockModule("fs", () => ({
    readFileSync: jest.fn().mockReturnValue("return 1"),
    default: {
        readFileSync: jest.fn().mockReturnValue("return 1"),
    },
}));

const { DragonflyQueueRepository } = await import(
    "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js"
);

describe("Unit: DragonflyQueueRepository Rate Limiting", () => {
    let mockRedis: Redis;
    let mockPipeline: Record<string, jest.Mock>;

    beforeEach(() => {
        mockPipeline = {
            hset: jest.fn().mockReturnThis(),
            hdel: jest.fn().mockReturnThis(),
            hgetall: jest.fn().mockReturnThis(),
            lrem: jest.fn().mockReturnThis(),
            hincrby: jest.fn().mockReturnThis(),
            eval: jest.fn().mockReturnThis(),
            evalsha: jest.fn().mockReturnThis(),
            exec: jest.fn(),
        };

        mockRedis = {
            eval: jest.fn(),
            pipeline: jest.fn().mockReturnValue(mockPipeline),
        } as unknown as Redis;

        jest.clearAllMocks();
    });

    it("should allow fetchNext when rateLimiter allows", async () => {
        const limiter: RateLimiterOptions = {
            max: 10,
            duration: 1000,
            burst: 10,
        };
        const repo = new DragonflyQueueRepository(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );

        // 1st eval/evalsha call: token_bucket -> allowed (1)
        // 2nd eval/evalsha call: move_job -> null
        (mockRedis.eval as jest.Mock)
            .mockResolvedValueOnce([1, "9", "0"] as never)
            .mockResolvedValueOnce(null as never);

        const job = await repo.fetchNext();
        expect(job).toBeNull();
        expect(mockRedis.eval).toHaveBeenCalledTimes(2);

        // Verify token_bucket called with rateLimitKey
        const firstCall = (mockRedis.eval as jest.Mock).mock.calls[0] as unknown[] | undefined;
        expect(firstCall).toBeDefined();
        expect(firstCall?.[2]).toContain(":ratelimit");
    });

    it("should deny fetchNext and move waiting job to delayed when rate limit exceeded", async () => {
        const limiter: RateLimiterOptions = {
            max: 5,
            duration: 1000,
            onExceeded: "delay",
            retryDelay: 500,
        };
        const repo = new DragonflyQueueRepository(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );

        // 1st eval: token_bucket -> denied (0)
        // 2nd eval: move_waiting_to_delayed -> ["job-123", "1234567"]
        (mockRedis.eval as jest.Mock)
            .mockResolvedValueOnce([0, "0", "200"] as never)
            .mockResolvedValueOnce(["job-123", "1234567"] as never);

        const job = await repo.fetchNext();
        expect(job).toBeNull();

        // Should have called token_bucket and move_waiting_to_delayed, but NOT move_job
        expect(mockRedis.eval).toHaveBeenCalledTimes(2);
        const secondCall = (mockRedis.eval as jest.Mock).mock.calls[1] as unknown[] | undefined;
        expect(secondCall).toBeDefined();
        // KEYS should include waiting and delayed keys
        expect(secondCall?.[2]).toContain(":waiting");
        expect(secondCall?.[3]).toContain(":delayed");
    });

    it("should deny fetchNextJobs and return empty array when rate limit exceeded", async () => {
        const limiter: RateLimiterOptions = {
            max: 5,
            duration: 1000,
            onExceeded: "delay",
            retryDelay: 500,
        };
        const repo = new DragonflyQueueRepository(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );

        // 1st eval: token_bucket -> denied (0)
        // 2nd eval: move_waiting_to_delayed -> ["job-123", "1234567"]
        (mockRedis.eval as jest.Mock)
            .mockResolvedValueOnce([0, "0", "200"] as never)
            .mockResolvedValueOnce(["job-123", "1234567"] as never);

        const jobs = await repo.fetchNextJobs(5, 30000);
        expect(jobs).toEqual([]);
    });

    it("should not move to delayed when onExceeded is 'reject'", async () => {
        const limiter: RateLimiterOptions = {
            max: 5,
            duration: 1000,
            onExceeded: "reject",
        };
        const repo = new DragonflyQueueRepository(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );

        // 1st eval: token_bucket -> denied (0)
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce([0, "0", "200"] as never);

        const job = await repo.fetchNext();
        expect(job).toBeNull();
        expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });

    it("should return rate limit status when getRateLimitStatus is called", async () => {
        const limiter: RateLimiterOptions = {
            max: 100,
            duration: 60000,
            burst: 120,
        };
        const repo = new DragonflyQueueRepository(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );

        (mockRedis.eval as jest.Mock).mockResolvedValueOnce([1, "75.5", "0"] as never);

        const status = await repo.getRateLimitStatus();
        expect(status).not.toBeNull();
        expect(status?.tokens).toBe(75.5);
        expect(status?.max).toBe(120);
        expect(status?.duration).toBe(60000);
    });
});
