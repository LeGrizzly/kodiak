import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { FetchJobUseCase } from "../../src/application/use-cases/fetch-job.use-case.js";
import type { Job } from "../../src/domain/entities/job.entity.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("FetchJobUseCase", () => {
    let fetchJobUseCase: FetchJobUseCase<string>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<string>>;

    const mockJob: Job<string> = {
        id: "job-1",
        data: "payload-1",
        status: "active",
        priority: 1,
        addedAt: new Date(),
        retryCount: 0,
        maxAttempts: 3,
    };

    beforeEach(() => {
        mockQueueRepository = {
            add: jest.fn(),
            fetchNext: jest.fn(),
            markAsCompleted: jest.fn(),
            markAsFailed: jest.fn(),
            updateProgress: jest.fn(),
            fetchNextJobs: jest.fn(),
            promoteDelayedJobs: jest.fn(),
            recoverStalledJobs: jest.fn(),
            extendLock: jest.fn(),
        } as unknown as jest.Mocked<IQueueRepository<string>>;

        fetchJobUseCase = new FetchJobUseCase(mockQueueRepository);
    });

    it("should fetch next job without timeout", async () => {
        mockQueueRepository.fetchNext.mockResolvedValue(mockJob);

        const result = await fetchJobUseCase.execute();

        expect(mockQueueRepository.fetchNext).toHaveBeenCalledWith(undefined);
        expect(result).toBe(mockJob);
    });

    it("should fetch next job with specified timeout", async () => {
        mockQueueRepository.fetchNext.mockResolvedValue(null);

        const result = await fetchJobUseCase.execute(5000);

        expect(mockQueueRepository.fetchNext).toHaveBeenCalledWith(5000);
        expect(result).toBeNull();
    });
});
