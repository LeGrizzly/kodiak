import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import type {
    IQueueRepository,
    IRateLimiterRepository,
    IRateLimitStatus,
} from "../../src/domain/repositories/queue.repository.js";
import type { Kodiak } from "../../src/presentation/kodiak.js";
import { Queue } from "../../src/presentation/queue.js";

describe("Unit: Queue Rate Limiting Methods", () => {
    let queue: Queue<{ message: string }>;
    let mockRepository: Mocked<IQueueRepository<{ message: string }> & IRateLimiterRepository>;
    let mockKodiak: Kodiak;

    beforeEach(() => {
        const mockConnection = {
            duplicate: vi.fn(() => mockConnection),
            quit: vi.fn<() => Promise<string>>().mockResolvedValue("OK"),
        };

        mockKodiak = {
            connection: mockConnection,
            prefix: "test",
        } as unknown as Kodiak;

        mockRepository = {
            add: vi.fn(),
            fetchNext: vi.fn(),
            fetchNextJobs: vi.fn(),
            markAsCompleted: vi.fn(),
            markAsFailed: vi.fn(),
            updateProgress: vi.fn(),
            promoteDelayedJobs: vi
                .fn<IQueueRepository<{ message: string }>["promoteDelayedJobs"]>()
                .mockResolvedValue(0 as never),
            recoverStalledJobs: vi
                .fn<IQueueRepository<{ message: string }>["recoverStalledJobs"]>()
                .mockResolvedValue([] as never),
            extendLock: vi.fn(),
            releaseJobs: vi.fn(),
            consumeRateLimit: vi.fn<IRateLimiterRepository["consumeRateLimit"]>(),
            getRateLimitStatus: vi.fn<IRateLimiterRepository["getRateLimitStatus"]>(),
        } as unknown as Mocked<IQueueRepository<{ message: string }> & IRateLimiterRepository>;

        queue = new Queue("test-queue", mockKodiak, mockRepository);
    });

    afterEach(async () => {
        await queue.close();
    });

    it("should call consumeRateLimit on use case and repository", async () => {
        mockRepository.consumeRateLimit.mockResolvedValue(true);

        const allowed = await queue.consumeRateLimit(3);

        expect(mockRepository.consumeRateLimit).toHaveBeenCalledWith(3);
        expect(allowed).toBe(true);
    });

    it("should default consumeRateLimit count to 1", async () => {
        mockRepository.consumeRateLimit.mockResolvedValue(false);

        const allowed = await queue.consumeRateLimit();

        expect(mockRepository.consumeRateLimit).toHaveBeenCalledWith(1);
        expect(allowed).toBe(false);
    });

    it("should call getRateLimitStatus and return status", async () => {
        const expectedStatus: IRateLimitStatus = {
            tokens: 50,
            max: 100,
            duration: 1000,
            resetAt: new Date(),
        };
        mockRepository.getRateLimitStatus.mockResolvedValue(expectedStatus);

        const status = await queue.getRateLimitStatus();

        expect(mockRepository.getRateLimitStatus).toHaveBeenCalled();
        expect(status).toEqual(expectedStatus);
    });

    it("should accept QueueOptions with rateLimiter configuration", async () => {
        const queueWithOptions = new Queue("options-queue", mockKodiak, mockRepository, {
            rateLimiter: { max: 20, duration: 1000, burst: 30 },
        });

        expect(queueWithOptions.name).toBe("options-queue");
        await queueWithOptions.close();
    });
});
