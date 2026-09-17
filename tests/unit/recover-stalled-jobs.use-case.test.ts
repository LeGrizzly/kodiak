import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import { RecoverStalledJobsUseCase } from "../../src/application/use-cases/recover-stalled-jobs.use-case.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("RecoverStalledJobsUseCase", () => {
    let recoverStalledJobsUseCase: RecoverStalledJobsUseCase<unknown>;
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
