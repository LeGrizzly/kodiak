import { jest } from "@jest/globals";
import { CompleteJobUseCase } from "../../src/application/use-cases/complete-job.use-case.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("CompleteJobUseCase", () => {
    let completeJobUseCase: CompleteJobUseCase<unknown>;
    let mockQueueRepository: jest.Mocked<IQueueRepository<unknown>>;

    beforeEach(() => {
        mockQueueRepository = {
            add: jest.fn(),
            fetchNext: jest.fn(),
            markAsCompleted: jest.fn().mockResolvedValue(undefined as never),
            markAsFailed: jest.fn(),
            updateProgress: jest.fn(),
            fetchNextJobs: jest.fn(),
            promoteDelayedJobs: jest.fn(),
            recoverStalledJobs: jest.fn(),
            extendLock: jest.fn(),
        } as unknown as jest.Mocked<IQueueRepository<unknown>>;
        completeJobUseCase = new CompleteJobUseCase(mockQueueRepository);
    });

    it("should call markAsCompleted on the repository", async () => {
        await completeJobUseCase.execute("job-123");

        expect(mockQueueRepository.markAsCompleted).toHaveBeenCalledWith(
            "job-123",
            expect.any(Date),
        );
    });

    it("should pass the current date to markAsCompleted", async () => {
        const beforeCall = new Date();
        await completeJobUseCase.execute("job-456");
        const afterCall = new Date();

        const calls = mockQueueRepository.markAsCompleted.mock.calls;
        const passedDate = calls[0]?.[1] as Date;

        expect(passedDate.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
        expect(passedDate.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });

    it("should call markManyAsCompleted when implemented on repository", async () => {
        const markManyAsCompleted = jest
            .fn<
                (jobs: { jobId: string; completedAt: Date; ownerToken?: string }) => Promise<void>
            >()
            .mockResolvedValue(undefined);
        mockQueueRepository.markManyAsCompleted = markManyAsCompleted as never;

        const jobs = [
            { jobId: "job-1", ownerToken: "token-1" },
            { jobId: "job-2", ownerToken: "token-2" },
        ];

        await completeJobUseCase.executeMany(jobs);

        expect(markManyAsCompleted).toHaveBeenCalledTimes(1);
        const arg = markManyAsCompleted.mock.calls[0]?.[0] as unknown as Array<{ jobId: string }>;
        expect(arg).toHaveLength(2);
        expect(arg[0]?.jobId).toBe("job-1");
        expect(arg[1]?.jobId).toBe("job-2");
    });

    it("should fall back to individual markAsCompleted calls when markManyAsCompleted is undefined", async () => {
        delete mockQueueRepository.markManyAsCompleted;

        const jobs = [
            { jobId: "job-A", ownerToken: "token-A" },
            { jobId: "job-B", ownerToken: "token-B" },
        ];

        await completeJobUseCase.executeMany(jobs);

        expect(mockQueueRepository.markAsCompleted).toHaveBeenCalledTimes(2);
        expect(mockQueueRepository.markAsCompleted).toHaveBeenCalledWith(
            "job-A",
            expect.any(Date),
            "token-A",
        );
        expect(mockQueueRepository.markAsCompleted).toHaveBeenCalledWith(
            "job-B",
            expect.any(Date),
            "token-B",
        );
    });

    it("should handle empty jobs array in executeMany without errors", async () => {
        const markManyAsCompleted = jest
            .fn<
                (jobs: { jobId: string; completedAt: Date; ownerToken?: string }) => Promise<void>
            >()
            .mockResolvedValue(undefined);
        mockQueueRepository.markManyAsCompleted = markManyAsCompleted as never;

        await completeJobUseCase.executeMany([]);

        expect(markManyAsCompleted).not.toHaveBeenCalled();
        expect(mockQueueRepository.markAsCompleted).not.toHaveBeenCalled();
    });
});
