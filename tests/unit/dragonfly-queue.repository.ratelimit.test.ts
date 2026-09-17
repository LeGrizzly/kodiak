import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RateLimiterOptions } from "../../src/application/dtos/rate-limiter-options.dto.js";

vi.doMock("fs", () => ({
    readFileSync: vi.fn().mockReturnValue("return 1"),
    default: {
        readFileSync: vi.fn().mockReturnValue("return 1"),
    },
}));

const { DragonflyQueueRepository } = await import(
    "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js"
);

describe("Unit: DragonflyQueueRepository Rate Limiting", () => {
    let mockRedis: Redis;
    let mockPipeline: Record<string, Mock>;

    beforeEach(() => {
        mockPipeline = {
            hset: vi.fn().mockReturnThis(),
            hdel: vi.fn().mockReturnThis(),
            hgetall: vi.fn().mockReturnThis(),
            lrem: vi.fn().mockReturnThis(),
            hincrby: vi.fn().mockReturnThis(),
            eval: vi.fn().mockReturnThis(),
            evalsha: vi.fn().mockReturnThis(),
            exec: vi.fn(),
        };

        mockRedis = {
            eval: vi.fn(),
            pipeline: vi.fn().mockReturnValue(mockPipeline),
        } as unknown as Redis;

        vi.clearAllMocks();
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
        (mockRedis.eval as Mock)
            .mockResolvedValueOnce([1, "9", "0"] as never)
            .mockResolvedValueOnce(null as never);

        const job = await repo.fetchNext();
        expect(job).toBeNull();
        expect(mockRedis.eval).toHaveBeenCalledTimes(2);

        // Verify token_bucket called with rateLimitKey
        const firstCall = (mockRedis.eval as Mock).mock.calls[0] as unknown[] | undefined;
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
        (mockRedis.eval as Mock)
            .mockResolvedValueOnce([0, "0", "200"] as never)
            .mockResolvedValueOnce(["job-123", "1234567"] as never);

        const job = await repo.fetchNext();
        expect(job).toBeNull();

        // Should have called token_bucket and move_waiting_to_delayed, but NOT move_job
        expect(mockRedis.eval).toHaveBeenCalledTimes(2);
        const secondCall = (mockRedis.eval as Mock).mock.calls[1] as unknown[] | undefined;
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
        (mockRedis.eval as Mock)
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
        (mockRedis.eval as Mock).mockResolvedValueOnce([0, "0", "200"] as never);

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

        (mockRedis.eval as Mock).mockResolvedValueOnce([1, "75.5", "0"] as never);

        const status = await repo.getRateLimitStatus();
        expect(status).not.toBeNull();
        expect(status?.tokens).toBe(75.5);
        expect(status?.max).toBe(120);
        expect(status?.duration).toBe(60000);
    });

    it("should handle scalar return from token_bucket in consumeRateLimit", async () => {
        const limiter: RateLimiterOptions = { max: 10, duration: 1000 };
        const repo = new DragonflyQueueRepository(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );
        (mockRedis.eval as Mock).mockResolvedValueOnce(1 as never);
        const allowed = await repo.consumeRateLimit(1);
        expect(allowed).toBe(true);
    });

    it("should handle scalar return and catch block in moveWaitingToDelayedWithDelay", async () => {
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

        // Case 1: scalar string return from move_waiting_to_delayed
        (mockRedis.eval as Mock)
            .mockResolvedValueOnce([0, "0", "500"] as never)
            .mockResolvedValueOnce("delayed-job-id" as never);

        const jobs1 = await repo.fetchNextJobs(1, 1000);
        expect(jobs1).toEqual([]);

        // Case 2: exception in move_waiting_to_delayed
        (mockRedis.eval as Mock)
            .mockResolvedValueOnce([0, "0", "500"] as never)
            .mockRejectedValueOnce(new Error("Redis error") as never);

        const jobs2 = await repo.fetchNextJobs(1, 1000);
        expect(jobs2).toEqual([]);
    });

    it("should return true in consumeRateLimit when rateLimiter is undefined", async () => {
        const repo = new DragonflyQueueRepository("test-queue", mockRedis, "kodiak-test");
        const allowed = await repo.consumeRateLimit();
        expect(allowed).toBe(true);
    });

    it("should return null in getRateLimitStatus when rateLimiter is undefined", async () => {
        const repo = new DragonflyQueueRepository("test-queue", mockRedis, "kodiak-test");
        const status = await repo.getRateLimitStatus();
        expect(status).toBeNull();
    });

    it("should use rate, capacity, and default duration fallbacks", async () => {
        const limiter = { rate: 50, capacity: 60 } as unknown as RateLimiterOptions;
        const repo = new DragonflyQueueRepository(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );
        (mockRedis.eval as Mock).mockResolvedValueOnce([1, "50", "0"] as never);
        const allowed = await repo.consumeRateLimit();
        expect(allowed).toBe(true);

        (mockRedis.eval as Mock).mockResolvedValueOnce([1, "40", "100"] as never);
        const status = await repo.getRateLimitStatus();
        expect(status?.tokens).toBe(40);
        expect(status?.max).toBe(60);
        expect(status?.duration).toBe(1000);
    });

    it("should fallback to defaults when rateLimiter options are empty", async () => {
        const limiter = {} as unknown as RateLimiterOptions;
        const repo = new DragonflyQueueRepository(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );
        (mockRedis.eval as Mock).mockResolvedValueOnce([1, "100", "0"] as never);
        const allowed = await repo.consumeRateLimit();
        expect(allowed).toBe(true);

        (mockRedis.eval as Mock).mockResolvedValueOnce("non-array" as never);
        const status = await repo.getRateLimitStatus();
        expect(status?.tokens).toBe(100);
        expect(status?.max).toBe(100);
    });

    it("should use default 500ms delay when retryDelay is not provided in fetchNext and fetchNextJobs", async () => {
        const limiter: RateLimiterOptions = { max: 5, duration: 1000 };
        const repo = new DragonflyQueueRepository(
            "test-queue",
            mockRedis,
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );

        // For fetchNext:
        (mockRedis.eval as Mock)
            .mockResolvedValueOnce([0, "0", "0"] as never)
            .mockResolvedValueOnce(["job-1"] as never);
        const job = await repo.fetchNext();
        expect(job).toBeNull();

        // For fetchNextJobs:
        (mockRedis.eval as Mock)
            .mockResolvedValueOnce([0, "0", "0"] as never)
            .mockResolvedValueOnce(["job-2"] as never);
        const jobs = await repo.fetchNextJobs(1, 1000);
        expect(jobs).toEqual([]);
    });

    it("should return empty array in fetchNextJobs when rate limit exceeded and onExceeded is reject", async () => {
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

        (mockRedis.eval as Mock).mockResolvedValueOnce([0, "0", "0"] as never);
        const jobs = await repo.fetchNextJobs(1, 1000);
        expect(jobs).toEqual([]);
    });
});
