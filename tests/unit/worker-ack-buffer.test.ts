import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { CompleteJobUseCase } from "../../src/application/use-cases/complete-job.use-case.js";
import type { Job } from "../../src/domain/entities/job.entity.js";
import { WorkerAckBuffer } from "../../src/presentation/worker-ack-buffer.js";

describe("WorkerAckBuffer", () => {
    let mockCompleteUseCase: {
        executeMany: jest.MockedFunction<CompleteJobUseCase<unknown>["executeMany"]>;
    };
    let onCompleted: jest.MockedFunction<(job: Job<unknown>) => void>;
    let onError: jest.MockedFunction<(error: Error) => void>;
    let onBatchFlushed: jest.MockedFunction<(count: number, durationMs: number) => void>;

    const createMockJob = (id: string): Job<unknown> => ({
        id,
        data: { test: true },
        status: "active",
        priority: 0,
        addedAt: new Date(),
        retryCount: 0,
        maxAttempts: 3,
    });

    beforeEach(() => {
        mockCompleteUseCase = {
            executeMany: jest.fn().mockResolvedValue(undefined as never) as never,
        };
        onCompleted = jest.fn();
        onError = jest.fn();
        onBatchFlushed = jest.fn();
    });

    it("should flush immediately when maxBatch threshold is reached", async () => {
        const buffer = new WorkerAckBuffer(
            mockCompleteUseCase as unknown as CompleteJobUseCase<unknown>,
            {
                maxBatch: 2,
                maxWaitMs: 100,
                onCompleted,
                onError,
                onBatchFlushed,
            },
        );

        const job1 = createMockJob("job-1");
        const job2 = createMockJob("job-2");

        const p1 = buffer.push(job1, "token-1");
        const p2 = buffer.push(job2, "token-2");

        await Promise.all([p1, p2]);

        expect(mockCompleteUseCase.executeMany).toHaveBeenCalledTimes(1);
        expect(mockCompleteUseCase.executeMany).toHaveBeenCalledWith([
            expect.objectContaining({ jobId: "job-1", ownerToken: "token-1" }),
            expect.objectContaining({ jobId: "job-2", ownerToken: "token-2" }),
        ]);

        expect(job1.status).toBe("completed");
        expect(job2.status).toBe("completed");
        expect(onCompleted).toHaveBeenCalledTimes(2);
        expect(onBatchFlushed).toHaveBeenCalledWith(2, expect.any(Number));
    });

    it("should flush via timer when maxBatch is not reached", async () => {
        const buffer = new WorkerAckBuffer(
            mockCompleteUseCase as unknown as CompleteJobUseCase<unknown>,
            {
                maxBatch: 10,
                maxWaitMs: 5,
                onCompleted,
                onError,
            },
        );

        const job1 = createMockJob("job-solo");
        await buffer.push(job1);

        expect(mockCompleteUseCase.executeMany).toHaveBeenCalledTimes(1);
        expect(job1.status).toBe("completed");
        expect(onCompleted).toHaveBeenCalledWith(job1);
    });

    it("should drain all pending jobs on demand", async () => {
        const buffer = new WorkerAckBuffer(
            mockCompleteUseCase as unknown as CompleteJobUseCase<unknown>,
            {
                maxBatch: 50,
                maxWaitMs: 1000, // long timer
                onCompleted,
            },
        );

        const jobA = createMockJob("job-A");
        const jobB = createMockJob("job-B");

        const pA = buffer.push(jobA);
        const pB = buffer.push(jobB);

        expect(buffer.pendingCount).toBe(2);

        await buffer.drain();

        await Promise.all([pA, pB]);

        expect(buffer.pendingCount).toBe(0);
        expect(mockCompleteUseCase.executeMany).toHaveBeenCalledTimes(1);
        expect(jobA.status).toBe("completed");
        expect(jobB.status).toBe("completed");
    });

    it("should reject promises and trigger onError if executeMany fails", async () => {
        const failureError = new Error("Redis cluster disconnected");
        mockCompleteUseCase.executeMany.mockRejectedValue(failureError as never);

        const buffer = new WorkerAckBuffer(
            mockCompleteUseCase as unknown as CompleteJobUseCase<unknown>,
            {
                maxBatch: 1,
                onError,
            },
        );

        const jobFail = createMockJob("job-fail");
        await expect(buffer.push(jobFail)).rejects.toThrow("Redis cluster disconnected");

        expect(onError).toHaveBeenCalledWith(failureError);
    });
});
