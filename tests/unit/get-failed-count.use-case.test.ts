import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import { GetFailedCountUseCase } from "../../src/application/use-cases/get-failed-count.use-case.js";
import type { IDLQRepository } from "../../src/domain/repositories/queue.repository.js";

describe("GetFailedCountUseCase", () => {
    let useCase: GetFailedCountUseCase<unknown>;
    let mockRepository: Mocked<IDLQRepository<unknown>>;

    beforeEach(() => {
        mockRepository = {
            getFailedCount: vi.fn<IDLQRepository<unknown>["getFailedCount"]>().mockResolvedValue(5),
            getFailedJobs: vi.fn(),
            retryJob: vi.fn(),
            retryAllFailed: vi.fn(),
            cleanFailed: vi.fn(),
        };
        useCase = new GetFailedCountUseCase(mockRepository);
    });

    it("should return the number of failed jobs from the repository", async () => {
        const count = await useCase.execute();

        expect(mockRepository.getFailedCount).toHaveBeenCalledTimes(1);
        expect(count).toBe(5);
    });
});
