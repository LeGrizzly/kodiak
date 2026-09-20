import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import { FetchJobsUseCase } from "../../src/application/use-cases/fetch-jobs.use-case.js";
import type { Job } from "../../src/domain/entities/job.entity.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("FetchJobsUseCase", () => {
    let fetchJobsUseCase: FetchJobsUseCase<number>;
    let mockQueueRepository: Mocked<IQueueRepository<number>>;

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
            add: vi.fn(),
            fetchNext: vi.fn(),
            markAsCompleted: vi.fn(),
            markAsFailed: vi.fn(),
            updateProgress: vi.fn(),
            fetchNextJobs: vi.fn(),
            promoteDelayedJobs: vi.fn(),
            recoverStalledJobs: vi.fn(),
            extendLock: vi.fn(),
        } as unknown as Mocked<IQueueRepository<number>>;

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
