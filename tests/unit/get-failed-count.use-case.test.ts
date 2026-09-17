import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { GetFailedCountUseCase } from "../../src/application/use-cases/get-failed-count.use-case.js";
import type { IDLQRepository } from "../../src/domain/repositories/queue.repository.js";

describe("GetFailedCountUseCase", () => {
    let useCase: GetFailedCountUseCase<unknown>;
    let mockRepository: jest.Mocked<IDLQRepository<unknown>>;

    beforeEach(() => {
        mockRepository = {
            getFailedCount: jest
                .fn<IDLQRepository<unknown>["getFailedCount"]>()
                .mockResolvedValue(5),
            getFailedJobs: jest.fn(),
            retryJob: jest.fn(),
            retryAllFailed: jest.fn(),
            cleanFailed: jest.fn(),
        };
        useCase = new GetFailedCountUseCase(mockRepository);
    });

    it("should return the number of failed jobs from the repository", async () => {
        const count = await useCase.execute();

        expect(mockRepository.getFailedCount).toHaveBeenCalledTimes(1);
        expect(count).toBe(5);
    });
});
