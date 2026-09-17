import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import { GetFailedJobsUseCase } from "../../src/application/use-cases/get-failed-jobs.use-case.js";
import type { Job } from "../../src/domain/entities/job.entity.js";
import type { IDLQRepository } from "../../src/domain/repositories/queue.repository.js";

describe("GetFailedJobsUseCase", () => {
    let useCase: GetFailedJobsUseCase<string>;
    let mockRepository: Mocked<IDLQRepository<string>>;

    const mockJob: Job<string> = {
        id: "job-failed-1",
        data: "test-data",
        status: "failed",
        priority: 10,
        addedAt: new Date(),
        failedAt: new Date(),
        retryCount: 3,
        maxAttempts: 3,
        error: "Fatal network timeout",
    };

    beforeEach(() => {
        mockRepository = {
            getFailedCount: vi.fn(),
            getFailedJobs: vi
                .fn<IDLQRepository<string>["getFailedJobs"]>()
                .mockResolvedValue([mockJob]),
            retryJob: vi.fn(),
            retryAllFailed: vi.fn(),
            cleanFailed: vi.fn(),
        };
        useCase = new GetFailedJobsUseCase(mockRepository);
    });

    it("should call getFailedJobs with default pagination arguments (0, 20)", async () => {
        const jobs = await useCase.execute();

        expect(mockRepository.getFailedJobs).toHaveBeenCalledWith(0, 20);
        expect(jobs).toEqual([mockJob]);
    });

    it("should pass custom start and limit to repository", async () => {
        await useCase.execute(10, 50);

        expect(mockRepository.getFailedJobs).toHaveBeenCalledWith(10, 50);
    });
});
