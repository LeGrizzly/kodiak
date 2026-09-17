import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Redis } from "ioredis";
import type { Kodiak } from "../../src/presentation/kodiak.js";

const mockFetchExecute = jest.fn();
const mockCompleteExecute = jest.fn();
const mockFailExecute = jest.fn();
const mockExtendLock = jest.fn().mockResolvedValue(true as never);
const mockReleaseJobs = jest.fn().mockResolvedValue(undefined as never);

jest.unstable_mockModule(
    "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js",
    () => ({
        DragonflyQueueRepository: jest
            .fn()
            .mockImplementation((_name, _conn, _pfx, _ser, _pipe, limiter) => ({
                updateProgress: jest.fn().mockResolvedValue(undefined as never),
                fetchNextJobs: mockFetchExecute,
                releaseJobs: mockReleaseJobs,
                extendLock: mockExtendLock,
                rateLimiter: limiter,
            })),
    }),
);

jest.unstable_mockModule("../../src/application/use-cases/fetch-jobs.use-case.js", () => ({
    FetchJobsUseCase: jest.fn().mockImplementation(() => ({
        execute: mockFetchExecute,
    })),
}));

jest.unstable_mockModule("../../src/application/use-cases/complete-job.use-case.js", () => ({
    CompleteJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockCompleteExecute,
    })),
}));

jest.unstable_mockModule("../../src/application/use-cases/fail-job.use-case.js", () => ({
    FailJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockFailExecute,
    })),
}));

const { Worker } = await import("../../src/presentation/worker.js");
const { DragonflyQueueRepository } = await import(
    "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js"
);

describe("Unit: Worker Rate Limiting Integration", () => {
    let mockKodiak: Kodiak;
    let processor: jest.MockedFunction<(job: unknown) => Promise<void>>;

    beforeEach(() => {
        const mockRedisConnection = {
            duplicate: jest.fn().mockReturnThis(),
            quit: jest.fn(),
            disconnect: jest.fn(),
            brpop: jest.fn(),
        };
        mockKodiak = {
            connection: mockRedisConnection as unknown as Redis,
            prefix: "kodiak-test",
        } as unknown as Kodiak;
        processor = jest.fn() as jest.MockedFunction<(job: unknown) => Promise<void>>;

        jest.clearAllMocks();
    });

    it("should pass rateLimiter options to DragonflyQueueRepository", () => {
        const limiter = { max: 10, duration: 1000, burst: 15 };
        new Worker("rate-limited-worker", processor, mockKodiak, {
            rateLimiter: limiter,
        });

        expect(DragonflyQueueRepository).toHaveBeenCalledWith(
            "rate-limited-worker",
            expect.anything(),
            "kodiak-test",
            undefined,
            undefined,
            limiter,
        );
    });

    it("should emit rateLimited event when fetch returns empty due to rate limiting", async () => {
        const limiter = { max: 2, duration: 1000, burst: 2 };
        const worker = new Worker("rate-limited-worker", processor, mockKodiak, {
            rateLimiter: limiter,
            concurrency: 1,
        });

        // Simulate rate limiter returning empty jobs
        mockFetchExecute.mockResolvedValueOnce([] as never);

        const rateLimitedListener = jest.fn();
        worker.on("rateLimited", rateLimitedListener);

        const job = await worker.getJob(0, "worker:0");
        expect(job).toBeNull();
        expect(rateLimitedListener).toHaveBeenCalled();
    });

    it("should clamp prefetch request when burst capacity is lower than prefetch default", async () => {
        const limiter = { max: 3, duration: 1000, burst: 3 };
        const worker = new Worker("clamped-worker", processor, mockKodiak, {
            rateLimiter: limiter,
            concurrency: 1,
        });

        mockFetchExecute.mockResolvedValueOnce([] as never);

        await worker.getJob(0, "worker:0");

        // The requested count in fetchJobsUseCase should be capped at burst (3)
        const requestedCount = mockFetchExecute.mock.calls[0]?.[0] as number;
        expect(requestedCount).toBeLessThanOrEqual(3);
        expect(mockFetchExecute).toHaveBeenCalledWith(
            requestedCount,
            expect.any(Number),
            "worker:0",
        );
    });
});
