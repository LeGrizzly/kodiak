import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import { PromoteDelayedJobsUseCase } from "../../src/application/use-cases/promote-delayed-jobs.use-case.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("PromoteDelayedJobsUseCase", () => {
    let promoteDelayedJobsUseCase: PromoteDelayedJobsUseCase<unknown>;
    let mockQueueRepository: Mocked<IQueueRepository<unknown>>;

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
        } as unknown as Mocked<IQueueRepository<unknown>>;

        promoteDelayedJobsUseCase = new PromoteDelayedJobsUseCase(mockQueueRepository);
    });

    it("should promote delayed jobs with default limit of 50", async () => {
        mockQueueRepository.promoteDelayedJobs.mockResolvedValue(5);

        const result = await promoteDelayedJobsUseCase.execute();

        expect(mockQueueRepository.promoteDelayedJobs).toHaveBeenCalledWith(50);
        expect(result).toBe(5);
    });

    it("should promote delayed jobs with specified limit", async () => {
        mockQueueRepository.promoteDelayedJobs.mockResolvedValue(12);

        const result = await promoteDelayedJobsUseCase.execute(100);

        expect(mockQueueRepository.promoteDelayedJobs).toHaveBeenCalledWith(100);
        expect(result).toBe(12);
    });
});
