import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type {
    IQueueRepository,
    IRateLimiterRepository,
    IRateLimitStatus,
} from "../../src/domain/repositories/queue.repository.js";
import type { Kodiak } from "../../src/presentation/kodiak.js";
import { Queue } from "../../src/presentation/queue.js";

describe("Unit: Queue Rate Limiting Methods", () => {
    let queue: Queue<{ message: string }>;
    let mockRepository: jest.Mocked<IQueueRepository<{ message: string }> & IRateLimiterRepository>;
    let mockKodiak: Kodiak;

    beforeEach(() => {
        const mockConnection = {
            duplicate: jest.fn(() => mockConnection),
            quit: jest.fn<() => Promise<string>>().mockResolvedValue("OK"),
        };

        mockKodiak = {
            connection: mockConnection,
            prefix: "test",
        } as unknown as Kodiak;

        mockRepository = {
            add: jest.fn(),
            fetchNext: jest.fn(),
            fetchNextJobs: jest.fn(),
            markAsCompleted: jest.fn(),
            markAsFailed: jest.fn(),
            updateProgress: jest.fn(),
            promoteDelayedJobs: jest
                .fn<IQueueRepository<{ message: string }>["promoteDelayedJobs"]>()
                .mockResolvedValue(0 as never),
            recoverStalledJobs: jest
                .fn<IQueueRepository<{ message: string }>["recoverStalledJobs"]>()
                .mockResolvedValue([] as never),
            extendLock: jest.fn(),
            releaseJobs: jest.fn(),
            consumeRateLimit: jest.fn<IRateLimiterRepository["consumeRateLimit"]>(),
            getRateLimitStatus: jest.fn<IRateLimiterRepository["getRateLimitStatus"]>(),
        } as unknown as jest.Mocked<IQueueRepository<{ message: string }> & IRateLimiterRepository>;

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
