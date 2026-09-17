import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Job } from "../../src/domain/entities/job.entity.js";
import type {
    IDLQRepository,
    IQueueRepository,
} from "../../src/domain/repositories/queue.repository.js";
import type { Kodiak } from "../../src/presentation/kodiak.js";
import { Queue } from "../../src/presentation/queue.js";

describe("Unit: Queue DLQ Methods", () => {
    let queue: Queue<{ message: string }>;
    let mockRepository: jest.Mocked<IQueueRepository<{ message: string }>>;
    let mockKodiak: Kodiak;

    const dummyJob: Job<{ message: string }> = {
        id: "dlq-job-1",
        data: { message: "error-data" },
        status: "failed",
        priority: 10,
        addedAt: new Date(),
        retryCount: 3,
        maxAttempts: 3,
        error: "Dead letter error",
    };

    beforeEach(() => {
        const mockConnection = {
            duplicate: jest.fn(() => mockConnection),
            quit: jest.fn<() => Promise<string>>().mockResolvedValue("OK"),
        };

        mockKodiak = {
            connection: mockConnection,
            prefix: "test",
        } as unknown as Kodiak;

        mockRepository = {
            add: jest.fn(),
            fetchNext: jest.fn(),
            fetchNextJobs: jest.fn(),
            markAsCompleted: jest.fn(),
            markAsFailed: jest.fn(),
            updateProgress: jest.fn(),
            promoteDelayedJobs: jest
                .fn<IQueueRepository<{ message: string }>["promoteDelayedJobs"]>()
                .mockResolvedValue(0 as never),
            recoverStalledJobs: jest
                .fn<IQueueRepository<{ message: string }>["recoverStalledJobs"]>()
                .mockResolvedValue([] as never),
            extendLock: jest.fn(),
            releaseJobs: jest.fn(),
            getFailedCount: jest
                .fn<IDLQRepository<{ message: string }>["getFailedCount"]>()
                .mockResolvedValue(12 as never),
            getFailedJobs: jest
                .fn<IDLQRepository<{ message: string }>["getFailedJobs"]>()
                .mockResolvedValue([dummyJob] as never),
            retryJob: jest
                .fn<IDLQRepository<{ message: string }>["retryJob"]>()
                .mockResolvedValue(true as never),
            retryAllFailed: jest
                .fn<IDLQRepository<{ message: string }>["retryAllFailed"]>()
                .mockResolvedValue(4 as never),
            cleanFailed: jest
                .fn<IDLQRepository<{ message: string }>["cleanFailed"]>()
                .mockResolvedValue(8 as never),
        };

        queue = new Queue<{ message: string }>("test-dlq", mockKodiak, mockRepository);
    });

    afterEach(async () => {
        await queue.close();
    });

    it("should delegate getFailedCount to repository", async () => {
        const count = await queue.getFailedCount();

        expect(mockRepository.getFailedCount).toHaveBeenCalledTimes(1);
        expect(count).toBe(12);
    });

    it("should delegate getFailedJobs to repository with arguments", async () => {
        const jobs = await queue.getFailedJobs(5, 15);

        expect(mockRepository.getFailedJobs).toHaveBeenCalledWith(5, 15);
        expect(jobs).toEqual([dummyJob]);
    });

    it("should delegate getFailedJobs to repository with default arguments", async () => {
        const jobs = await queue.getFailedJobs();

        expect(mockRepository.getFailedJobs).toHaveBeenCalledWith(0, 20);
        expect(jobs).toEqual([dummyJob]);
    });

    it("should delegate retryJob to repository", async () => {
        const retried = await queue.retryJob("dlq-job-1");

        expect(mockRepository.retryJob).toHaveBeenCalledWith("dlq-job-1");
        expect(retried).toBe(true);
    });

    it("should delegate retryAllFailed to repository with limit", async () => {
        const count = await queue.retryAllFailed(50);

        expect(mockRepository.retryAllFailed).toHaveBeenCalledWith(50);
        expect(count).toBe(4);
    });

    it("should delegate retryAllFailed to repository with default limit", async () => {
        const count = await queue.retryAllFailed();

        expect(mockRepository.retryAllFailed).toHaveBeenCalledWith(100);
        expect(count).toBe(4);
    });

    it("should delegate cleanFailed to repository with olderThanMs", async () => {
        const cleaned = await queue.cleanFailed(3600000);

        expect(mockRepository.cleanFailed).toHaveBeenCalledWith(3600000);
        expect(cleaned).toBe(8);
    });

    it("should delegate cleanFailed to repository with default olderThanMs", async () => {
        const cleaned = await queue.cleanFailed();

        expect(mockRepository.cleanFailed).toHaveBeenCalledWith(0);
        expect(cleaned).toBe(8);
    });
});
