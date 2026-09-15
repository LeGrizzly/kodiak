import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { RecoverStalledJobsUseCase } from "../../src/application/use-cases/recover-stalled-jobs.use-case.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("RecoverStalledJobsUseCase", () => {
    let recoverStalledJobsUseCase: RecoverStalledJobsUseCase<unknown>;
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

        recoverStalledJobsUseCase = new RecoverStalledJobsUseCase(mockQueueRepository);
    });

    it("should call recoverStalledJobs on repository and return recovered job IDs", async () => {
        const recoveredIds = ["job-stalled-1", "job-stalled-2"];
        mockQueueRepository.recoverStalledJobs.mockResolvedValue(recoveredIds);

        const result = await recoverStalledJobsUseCase.execute();

        expect(mockQueueRepository.recoverStalledJobs).toHaveBeenCalledTimes(1);
        expect(result).toBe(recoveredIds);
    });
});
