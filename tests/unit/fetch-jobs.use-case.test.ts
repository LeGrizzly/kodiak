import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { FetchJobsUseCase } from "../../src/application/use-cases/fetch-jobs.use-case.js";
import type { Job } from "../../src/domain/entities/job.entity.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("FetchJobsUseCase", () => {
    let fetchJobsUseCase: FetchJobsUseCase<number>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<number>>;

    const mockJobs: Job<number>[] = [
        {
            id: "j-1",
            data: 10,
            status: "active",
            priority: 1,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 3,
        },
    ];

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
        } as unknown as jest.Mocked<IQueueRepository<number>>;

        fetchJobsUseCase = new FetchJobsUseCase(mockQueueRepository);
    });

    it("should fetch batch of jobs without ownerToken", async () => {
        mockQueueRepository.fetchNextJobs.mockResolvedValue(mockJobs);

        const result = await fetchJobsUseCase.execute(10, 30000);

        expect(mockQueueRepository.fetchNextJobs).toHaveBeenCalledWith(10, 30000, undefined);
        expect(result).toBe(mockJobs);
    });

    it("should fetch batch of jobs with ownerToken", async () => {
        mockQueueRepository.fetchNextJobs.mockResolvedValue([]);

        const result = await fetchJobsUseCase.execute(5, 15000, "worker-tok-123");

        expect(mockQueueRepository.fetchNextJobs).toHaveBeenCalledWith(5, 15000, "worker-tok-123");
        expect(result).toEqual([]);
    });
});
