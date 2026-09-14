import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ReleaseJobsUseCase } from "../../src/application/use-cases/release-jobs.use-case.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("ReleaseJobsUseCase", () => {
    let mockQueueRepository: jest.Mocked<IQueueRepository<unknown>>;
    let useCase: ReleaseJobsUseCase<unknown>;

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
            releaseJobs: jest
                .fn<IQueueRepository<unknown>["releaseJobs"]>()
                .mockResolvedValue(undefined),
            extendLock: jest.fn(),
        };
        useCase = new ReleaseJobsUseCase(mockQueueRepository);
    });

    it("should do nothing when jobIds array is empty or undefined", async () => {
        await useCase.execute([]);
        expect(mockQueueRepository.releaseJobs).not.toHaveBeenCalled();

        await useCase.execute(undefined as unknown as string[]);
        expect(mockQueueRepository.releaseJobs).not.toHaveBeenCalled();
    });

    it("should delegate to repository releaseJobs with list of job IDs", async () => {
        const jobIds = ["job-1", "job-2", "job-3"];
        await useCase.execute(jobIds);

        expect(mockQueueRepository.releaseJobs).toHaveBeenCalledWith(jobIds);
    });
});
