import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import { CleanFailedJobsUseCase } from "../../src/application/use-cases/clean-failed-jobs.use-case.js";
import type { IDLQRepository } from "../../src/domain/repositories/queue.repository.js";

describe("CleanFailedJobsUseCase", () => {
    let useCase: CleanFailedJobsUseCase<unknown>;
    let mockRepository: Mocked<IDLQRepository<unknown>>;

    beforeEach(() => {
        mockRepository = {
            getFailedCount: vi.fn(),
            getFailedJobs: vi.fn(),
            retryJob: vi.fn(),
            retryAllFailed: vi.fn(),
            cleanFailed: vi.fn<IDLQRepository<unknown>["cleanFailed"]>().mockResolvedValue(10),
        };
        useCase = new CleanFailedJobsUseCase(mockRepository);
    });

    it("should clean failed jobs with default olderThanMs (0)", async () => {
        const cleaned = await useCase.execute();

        expect(mockRepository.cleanFailed).toHaveBeenCalledWith(0);
        expect(cleaned).toBe(10);
    });

    it("should clean failed jobs older than specified duration in milliseconds", async () => {
        const cleaned = await useCase.execute(86400000); // 24 hours

        expect(mockRepository.cleanFailed).toHaveBeenCalledWith(86400000);
        expect(cleaned).toBe(10);
    });
});
