import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import { RetryFailedJobUseCase } from "../../src/application/use-cases/retry-failed-job.use-case.js";
import type { IDLQRepository } from "../../src/domain/repositories/queue.repository.js";

describe("RetryFailedJobUseCase", () => {
    let useCase: RetryFailedJobUseCase<unknown>;
    let mockRepository: Mocked<IDLQRepository<unknown>>;

    beforeEach(() => {
        mockRepository = {
            getFailedCount: vi.fn(),
            getFailedJobs: vi.fn(),
            retryJob: vi.fn<IDLQRepository<unknown>["retryJob"]>().mockResolvedValue(true),
            retryAllFailed: vi.fn<IDLQRepository<unknown>["retryAllFailed"]>().mockResolvedValue(3),
            cleanFailed: vi.fn(),
        };
        useCase = new RetryFailedJobUseCase(mockRepository);
    });

    it("should retry an individual job by delegating to repository.retryJob", async () => {
        const result = await useCase.execute("job-123");

        expect(mockRepository.retryJob).toHaveBeenCalledWith("job-123");
        expect(result).toBe(true);
    });

    it("should replay all failed jobs with default limit (100)", async () => {
        const count = await useCase.executeAll();

        expect(mockRepository.retryAllFailed).toHaveBeenCalledWith(100);
        expect(count).toBe(3);
    });

    it("should replay all failed jobs with custom limit", async () => {
        const count = await useCase.executeAll(25);

        expect(mockRepository.retryAllFailed).toHaveBeenCalledWith(25);
        expect(count).toBe(3);
    });
});
