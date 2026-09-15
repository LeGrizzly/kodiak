import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { PromoteDelayedJobsUseCase } from "../../src/application/use-cases/promote-delayed-jobs.use-case.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("PromoteDelayedJobsUseCase", () => {
    let promoteDelayedJobsUseCase: PromoteDelayedJobsUseCase<unknown>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<unknown>>;

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
        } as unknown as jest.Mocked<IQueueRepository<unknown>>;

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
