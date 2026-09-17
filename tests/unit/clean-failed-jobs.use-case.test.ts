import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { CleanFailedJobsUseCase } from "../../src/application/use-cases/clean-failed-jobs.use-case.js";
import type { IDLQRepository } from "../../src/domain/repositories/queue.repository.js";

describe("CleanFailedJobsUseCase", () => {
    let useCase: CleanFailedJobsUseCase<unknown>;
    let mockRepository: jest.Mocked<IDLQRepository<unknown>>;

    beforeEach(() => {
        mockRepository = {
            getFailedCount: jest.fn(),
            getFailedJobs: jest.fn(),
            retryJob: jest.fn(),
            retryAllFailed: jest.fn(),
            cleanFailed: jest.fn<IDLQRepository<unknown>["cleanFailed"]>().mockResolvedValue(10),
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
