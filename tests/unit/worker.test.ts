import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Redis } from "ioredis";
import type { Job } from "../../src/domain/entities/job.entity.js";
import type { Kodiak } from "../../src/presentation/kodiak.js";

const mockFetchExecute = jest.fn();
const mockCompleteExecute = jest.fn();
const mockCompleteManyExecute = jest.fn();
const mockFailExecute = jest.fn();

const mockExtendLock = jest.fn().mockResolvedValue(true as never);
const mockReleaseJobs = jest.fn().mockResolvedValue(undefined as never);

jest.unstable_mockModule(
    "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js",
    () => ({
        DragonflyQueueRepository: jest.fn().mockImplementation(() => ({
            updateProgress: jest.fn().mockResolvedValue(undefined as never),
            fetchNextJobs: jest.fn(),
            releaseJobs: mockReleaseJobs,
            extendLock: mockExtendLock,
        })),
    }),
);

jest.unstable_mockModule("../../src/application/use-cases/fetch-jobs.use-case.js", () => ({
    FetchJobsUseCase: jest.fn().mockImplementation(() => ({
        execute: mockFetchExecute,
    })),
}));

jest.unstable_mockModule("../../src/application/use-cases/complete-job.use-case.js", () => ({
    CompleteJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockCompleteExecute,
        executeMany: mockCompleteManyExecute,
    })),
}));

jest.unstable_mockModule("../../src/application/use-cases/fail-job.use-case.js", () => ({
    FailJobUseCase: jest.fn().mockImplementation(() => ({
        execute: mockFailExecute,
    })),
}));

const { Worker } = await import("../../src/presentation/worker.js");
const { FetchJobsUseCase } = await import("../../src/application/use-cases/fetch-jobs.use-case.js");
const { CompleteJobUseCase } = await import(
    "../../src/application/use-cases/complete-job.use-case.js"
);
const { FailJobUseCase } = await import("../../src/application/use-cases/fail-job.use-case.js");

describe("Worker", () => {
    let mockKodiak: Kodiak;
    let processor: jest.MockedFunction<(job: unknown) => Promise<void>>;

    beforeEach(() => {
        const mockRedisConnection = {
            duplicate: jest.fn().mockReturnThis(),
            quit: jest.fn(),
            disconnect: jest.fn(),
            brpop: jest.fn(),
        };
        mockKodiak = {
            connection: mockRedisConnection as unknown as Redis,
            prefix: "kodiak-test",
        } as unknown as Kodiak;
        processor = jest.fn() as jest.MockedFunction<(job: unknown) => Promise<void>>;

        (FetchJobsUseCase as unknown as jest.Mock).mockClear();
        (CompleteJobUseCase as unknown as jest.Mock).mockClear();
        (FailJobUseCase as unknown as jest.Mock).mockClear();

        mockFetchExecute.mockReset();
        mockFetchExecute.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return [];
        });

        mockCompleteExecute.mockReset();
        mockCompleteExecute.mockResolvedValue(undefined as never);

        mockCompleteManyExecute.mockReset();
        mockCompleteManyExecute.mockResolvedValue(undefined as never);

        mockFailExecute.mockReset();
        mockFailExecute.mockResolvedValue(undefined as never);

        mockExtendLock.mockReset();
        mockExtendLock.mockResolvedValue(true as never);

        mockReleaseJobs.mockReset();
        mockReleaseJobs.mockResolvedValue(undefined as never);
    });

    const createMockJob = (overrides: Partial<Job<unknown>> = {}): Job<unknown> => ({
        id: "job-123",
        data: {},
        status: "active",
        priority: 0,
        addedAt: new Date(),
        retryCount: 0,
        maxAttempts: 3,
        updateProgress: async () => Promise.resolve(),
        ...overrides,
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("should create a worker instance", () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        expect(worker.name).toBe("test-queue");
    });

    it("should emit start event when started", async () => {
        jest.useFakeTimers();
        const worker = new Worker("test-queue", processor, mockKodiak);
        const startEmitter = jest.fn();
        worker.on("start", startEmitter);

        await worker.start();
        await jest.advanceTimersByTimeAsync(100);

        expect(startEmitter).toHaveBeenCalled();

        await worker.stop();
    });

    it("should emit stop event when stopped", async () => {
        jest.useFakeTimers();
        const worker = new Worker("test-queue", processor, mockKodiak);
        const stopEmitter = jest.fn();
        worker.on("stop", stopEmitter);

        await worker.start();
        await jest.advanceTimersByTimeAsync(100);
        await worker.stop();

        expect(stopEmitter).toHaveBeenCalled();
    });

    it("should process a job and emit completed event on success", async () => {
        const worker = new Worker<{ message: string }>("test-queue", processor, mockKodiak);
        const completedEmitter = jest.fn();
        worker.on("completed", completedEmitter);

        const mockJob = createMockJob({
            data: { message: "test" },
            priority: 10,
        });

        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        processor.mockResolvedValue(undefined);

        await worker.start();

        await new Promise(process.nextTick);
        await new Promise(process.nextTick);

        expect(processor).toHaveBeenCalledWith(mockJob);

        expect(mockCompleteExecute).toHaveBeenCalledWith(mockJob.id);
        expect(completedEmitter).toHaveBeenCalledWith(mockJob);

        await worker.stop();
    });

    it("should process a job and emit failed event on error", async () => {
        const worker = new Worker<{ message: string }>("test-queue", processor, mockKodiak);
        const failedEmitter = jest.fn();
        worker.on("failed", failedEmitter);

        const mockJob = createMockJob({
            data: { message: "test" },
            priority: 10,
        });

        const testError = new Error("Processing failed");

        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        processor.mockRejectedValue(testError);

        await worker.start();

        await new Promise(process.nextTick);
        await new Promise(process.nextTick);

        expect(processor).toHaveBeenCalledWith(mockJob);

        expect(mockFailExecute).toHaveBeenCalledWith(mockJob, testError);
        expect(failedEmitter).toHaveBeenCalledWith(mockJob, testError);

        await worker.stop();
    });

    it("should throw error if started while already running", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        await worker.start();

        await expect(worker.start()).rejects.toThrow('Worker "test-queue" is already running');

        await worker.stop();
    });

    it("should respect semaphore concurrency (prefetch logic)", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak, {
            concurrency: 1,
            prefetch: 1,
        });

        const job1 = createMockJob({
            id: "job-1",
            data: { id: 1 },
            priority: 10,
        });
        const job2 = createMockJob({
            id: "job-2",
            data: { id: 2 },
            priority: 10,
        });

        mockFetchExecute
            .mockResolvedValueOnce([job1] as never)
            .mockResolvedValueOnce([job2] as never);

        let releaseJob1: (value: void) => void = () => {};
        const job1Blocker = new Promise<void>((resolve) => {
            releaseJob1 = resolve;
        });

        processor.mockImplementation(async (job: unknown) => {
            const j = job as Job<{ id: number }>;
            if (j?.data?.id === 1) {
                await job1Blocker;
            }
        });

        await worker.start();

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(processor).toHaveBeenCalledWith(job1);
        expect(processor).not.toHaveBeenCalledWith(job2);

        releaseJob1();

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(processor).toHaveBeenCalledWith(job2);

        await worker.stop();
    });

    it("should handle non-Error objects thrown by processor", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        const failedEmitter = jest.fn();
        worker.on("failed", failedEmitter);

        const mockJob = createMockJob({
            id: "job-string-error",
            data: { message: "test" },
            priority: 10,
        });

        const stringError = "I am not an Error object";

        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        processor.mockRejectedValue(stringError);

        await worker.start();

        await new Promise(process.nextTick);
        await new Promise(process.nextTick);

        expect(mockFailExecute).toHaveBeenCalledWith(
            mockJob,
            expect.objectContaining({ message: stringError }),
        );
        expect(failedEmitter).toHaveBeenCalledWith(
            mockJob,
            expect.objectContaining({ message: stringError }),
        );

        await worker.stop();
    });

    it("should update progress and emit progress event", async () => {
        const progressEmitter = jest.fn();
        const mockJob = createMockJob({
            id: "job-progress",
            data: { message: "test" },
            priority: 10,
        });

        const processorWithProgress = jest.fn().mockImplementation(async (job: unknown) => {
            const j = job as Job<{ message: string }>;
            if (j.updateProgress) {
                await j.updateProgress(50);
            }
        }) as jest.MockedFunction<(job: unknown) => Promise<void>>;

        const worker = new Worker<{ message: string }>(
            "test-queue",
            processorWithProgress,
            mockKodiak,
        );
        worker.on("progress", progressEmitter);

        mockFetchExecute.mockResolvedValueOnce([mockJob] as never);

        await worker.start();

        await new Promise(process.nextTick);
        await new Promise(process.nextTick);

        expect(processorWithProgress).toHaveBeenCalledWith(mockJob);
        expect(progressEmitter).toHaveBeenCalledWith(mockJob, 50);

        await worker.stop();
    });

    it("should handle graceful shutdown timeout", async () => {
        jest.useFakeTimers();
        const errorEmitter = jest.fn();
        const worker = new Worker("test-queue", processor, mockKodiak, {
            gracefulShutdownTimeout: 10,
        });
        worker.on("error", errorEmitter);

        const mockJob = createMockJob();
        mockFetchExecute.mockResolvedValueOnce([mockJob] as never);

        processor.mockImplementation(async () => {
            return new Promise((resolve) => setTimeout(resolve, 200));
        });

        await worker.start();
        await jest.advanceTimersByTimeAsync(50);
        await worker.stop();

        expect(errorEmitter).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining("Graceful shutdown") }),
        );
    });

    it("should handle errors during Redis connection disconnect", async () => {
        const disconnectError = new Error("Disconnect failed");

        const mockRedisConnection = {
            duplicate: jest.fn().mockReturnThis(),
            disconnect: jest.fn().mockImplementation(() => {
                throw disconnectError;
            }),
        };

        (mockKodiak as unknown as { connection: Redis }).connection =
            mockRedisConnection as unknown as Redis;

        const worker = new Worker("test-queue", processor, mockKodiak);
        const errorEmitter = jest.fn();
        worker.on("error", errorEmitter);

        await worker.start();
        await worker.stop();

        expect(errorEmitter).toHaveBeenCalledTimes(2);
        expect(errorEmitter).toHaveBeenCalledWith(disconnectError);
    });

    it("should emit error if getJob fails", async () => {
        jest.useFakeTimers();
        const errorEmitter = jest.fn();
        const testError = new Error("Fetch failed");
        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("error", errorEmitter);
        mockFetchExecute.mockRejectedValueOnce(testError as never);

        await worker.start();
        await jest.advanceTimersByTimeAsync(100);
        expect(errorEmitter).toHaveBeenCalledWith(testError);
        await worker.stop();
    });

    it("should handle race conditions with concurrent buffer pop", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        const job1 = createMockJob({ id: "j1" });
        const job2 = createMockJob({ id: "j2" });

        const bufferLock = worker.bufferLock;

        worker.jobBuffers.set(0, [job1]);

        await bufferLock.acquire();

        const workerInternal = worker as unknown as {
            getJob: (slot: number, ownerToken: string) => Promise<Job<unknown> | null>;
        };
        const getJobPromise = workerInternal.getJob(0, "owner-token");

        worker.jobBuffers.get(0)?.push(job2);
        bufferLock.release();

        const result = await getJobPromise;

        expect(result?.id).toBe("j1");

        await worker.stop();
    });

    it("should get job from buffer if available before fetching", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        const jobInBuffer = createMockJob({ id: "buffered-job" });

        worker.jobBuffers.set(0, [jobInBuffer]);

        const workerInternal = worker as unknown as {
            getJob: (slot: number, ownerToken: string) => Promise<Job<unknown> | null>;
        };
        const getJobResult = await workerInternal.getJob(0, "owner-token");
        expect(getJobResult?.id).toBe("buffered-job");
        await worker.stop();
    });

    it("should handle error during ack connection disconnect", async () => {
        const disconnectError = new Error("ACK Disconnect failed");

        const mockAckConnection = {
            disconnect: jest.fn(() => {
                throw disconnectError;
            }),
        };
        const mockBlockingConnection = { disconnect: jest.fn() };
        (mockKodiak.connection.duplicate as jest.Mock)
            .mockReturnValueOnce(mockAckConnection)
            .mockReturnValueOnce(mockBlockingConnection);

        const worker = new Worker("test-queue", processor, mockKodiak);
        const errorEmitter = jest.fn();
        worker.on("error", errorEmitter);
        await worker.stop();

        expect(errorEmitter).toHaveBeenCalledWith(disconnectError);
        expect(errorEmitter).toHaveBeenCalledTimes(1);
    });

    it("should return null if job from buffer is falsy", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);

        // Pushing undefined to test falsy path
        worker.jobBuffers.set(0, [undefined as unknown as Job<unknown>]);

        const workerInternal = worker as unknown as {
            getJob: (slot: number, ownerToken: string) => Promise<Job<unknown> | null>;
        };
        const job = await workerInternal.getJob(0, "owner-token");
        expect(job).toBeNull();

        await worker.stop();
    });

    it("should ignore non-Error objects thrown in main process loop", async () => {
        const errorEmitter = jest.fn();
        const nonError = "some string error";

        mockFetchExecute.mockRejectedValueOnce(nonError as never);

        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("error", errorEmitter);

        await worker.start();

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(errorEmitter).not.toHaveBeenCalled();

        await worker.stop();
    });

    it("should process jobs with ackPipelining and call executeMany on flush", async () => {
        const worker = new Worker<{ message: string }>("test-queue", processor, mockKodiak, {
            ackPipelining: { maxBatch: 1, maxWaitMs: 0 },
        });

        const completedEmitter = jest.fn();
        worker.on("completed", completedEmitter);

        const mockJob = createMockJob({ id: "job-pipeline-1", data: { message: "pipelined" } });
        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        processor.mockResolvedValue(undefined);

        await worker.start();

        await new Promise(process.nextTick);
        await new Promise(process.nextTick);
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(processor).toHaveBeenCalledWith(mockJob);
        expect(mockCompleteManyExecute).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ jobId: "job-pipeline-1" })]),
        );
        expect(completedEmitter).toHaveBeenCalledWith(mockJob);

        await worker.stop();
    });

    it("should expose activeCount and getTelemetry getters", () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        expect(worker.activeCount).toBe(0);
        const telemetry = worker.getTelemetry();
        expect(telemetry).toEqual({
            fetchCount: 0,
            fetchDurationMs: 0,
            processCount: 0,
            processDurationMs: 0,
            ackCount: 0,
            ackDurationMs: 0,
            idleDurationMs: 0,
        });
    });

    it("should track telemetry metrics across fetch, process, idle, and ack with and without pipelining", async () => {
        const worker = new Worker<{ id: string }>("test-queue", processor, mockKodiak, {
            telemetry: true,
            ackPipelining: false,
        });

        const mockJob = createMockJob({ id: "telemetry-job-1" });
        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        processor.mockResolvedValue(undefined);

        await worker.start();
        await new Promise((resolve) => setTimeout(resolve, 150));
        await worker.stop();

        const t = worker.getTelemetry();
        expect(t.fetchCount).toBeGreaterThanOrEqual(1);
        expect(t.processCount).toBe(1);
        expect(t.ackCount).toBe(1);
        expect(t.idleDurationMs).toBeGreaterThan(0);

        // Also test ackBuffer telemetry (onBatchFlushed)
        const pipelinedWorker = new Worker<{ id: string }>("test-queue", processor, mockKodiak, {
            telemetry: true,
            ackPipelining: { maxBatch: 1, maxWaitMs: 0 },
        });

        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        await pipelinedWorker.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await pipelinedWorker.stop();

        const pt = pipelinedWorker.getTelemetry();
        expect(pt.ackCount).toBe(1);
    });

    it("should execute bound heartbeat and updateProgress callbacks from contextPool and emit progress", async () => {
        let capturedHeartbeatResult = false;
        processor.mockImplementation(async (job: unknown) => {
            const ctx = job as {
                heartbeat?: () => Promise<boolean>;
                updateProgress?: (n: number) => Promise<void>;
            };
            if (ctx.heartbeat) {
                capturedHeartbeatResult = await ctx.heartbeat();
            }
            if (ctx.updateProgress) {
                await ctx.updateProgress(75);
            }
        });

        const progressEmitter = jest.fn();
        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("progress", progressEmitter);

        const mockJob = createMockJob({ id: "heartbeat-job-1" });
        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        await worker.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await worker.stop();

        expect(capturedHeartbeatResult).toBe(true);
        expect(mockExtendLock).toHaveBeenCalledWith(
            "heartbeat-job-1",
            expect.any(Number),
            expect.any(String),
        );
        expect(progressEmitter).toHaveBeenCalledWith(
            expect.objectContaining({ id: "heartbeat-job-1" }),
            75,
        );
    });

    it("should forward ackBuffer onError to worker error event", async () => {
        const errorEmitter = jest.fn();
        const ackError = new Error("Pipelined ack failed");
        mockCompleteManyExecute.mockRejectedValueOnce(ackError as never);

        const worker = new Worker("test-queue", processor, mockKodiak, {
            ackPipelining: { maxBatch: 1, maxWaitMs: 0 },
        });
        worker.on("error", errorEmitter);

        const mockJob = createMockJob({ id: "err-job-1" });
        mockFetchExecute
            .mockResolvedValueOnce([mockJob] as never)
            .mockResolvedValueOnce([] as never);

        processor.mockResolvedValue(undefined);

        await worker.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await worker.stop();

        expect(errorEmitter).toHaveBeenCalledWith(ackError);
    });

    it("should return null in getJob when prefetch sizing gives 0 granted credits", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak, {
            prefetch: { min: 0, max: 0 },
        });

        const workerInternal = worker as unknown as {
            getJob: (slot: number, ownerToken: string) => Promise<Job<unknown> | null>;
        };

        const job = await workerInternal.getJob(0, "tok");
        expect(job).toBeNull();
    });

    it("should emit error if releaseJobs fails during stop with unconsumed jobs", async () => {
        const errorEmitter = jest.fn();
        mockReleaseJobs.mockRejectedValueOnce(new Error("Release unconsumed failed") as never);

        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("error", errorEmitter);

        worker.jobBuffers.set(0, [createMockJob({ id: "unconsumed-job" })]);

        await worker.stop();

        expect(errorEmitter).toHaveBeenCalledWith(
            expect.objectContaining({ message: "Release unconsumed failed" }),
        );
    });

    it("should emit error if disconnectSafe catches an error", () => {
        const errorEmitter = jest.fn();
        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("error", errorEmitter);

        const workerInternal = worker as unknown as {
            disconnectSafe: (conn: { disconnect: () => void }) => void;
        };

        workerInternal.disconnectSafe({
            disconnect: () => {
                throw new Error("Disconnect broken");
            },
        });

        expect(errorEmitter).toHaveBeenCalledWith(
            expect.objectContaining({ message: "Disconnect broken" }),
        );
    });

    it("should emit error when processSlotLoop encounters an Error in main loop", async () => {
        const errorEmitter = jest.fn();
        mockFetchExecute.mockRejectedValueOnce(new Error("Fetch failed in loop") as never);

        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("error", errorEmitter);

        await worker.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await worker.stop();

        expect(errorEmitter).toHaveBeenCalledWith(
            expect.objectContaining({ message: "Fetch failed in loop" }),
        );
    });

    it("should accept credits as number, credits as object, and ackPipelining as boolean true", async () => {
        // 1. credits as number
        const workerNumCredits = new Worker("test-queue", processor, mockKodiak, {
            credits: 50,
        });
        expect(workerNumCredits).toBeDefined();

        // 2. credits as object, ackPipelining as true (boolean)
        const workerObjCredits = new Worker("test-queue", processor, mockKodiak, {
            credits: { maxCredits: 40, replenishBatchThreshold: 5 },
            ackPipelining: true,
        });
        expect(workerObjCredits).toBeDefined();
    });

    it("should handle falsy jobs and undefined elements in getJob", async () => {
        const worker = new Worker("test-queue", processor, mockKodiak);
        const workerInternal = worker as unknown as {
            getJob: (slot: number, ownerToken: string) => Promise<Job<unknown> | null>;
        };

        // 1. mockFetchExecute returning null (falsy jobs -> fetchedCount = 0)
        (
            mockFetchExecute as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>
        ).mockResolvedValueOnce(null);
        const resNull = await workerInternal.getJob(0, "tok");
        expect(resNull).toBeNull();

        // 2. mockFetchExecute returning [undefined] (triggers return job ?? null)
        (
            mockFetchExecute as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>
        ).mockResolvedValueOnce([undefined]);
        const resUndef = await workerInternal.getJob(0, "tok");
        expect(resUndef).toBeNull();
    });

    it("should handle undefined elements during releaseUnconsumedJobs and non-Error in stop", async () => {
        const errorEmitter = jest.fn();
        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("error", errorEmitter);

        // slot buffer containing undefined item
        worker.jobBuffers.set(0, [
            undefined as unknown as Job<unknown>,
            createMockJob({ id: "valid-unconsumed" }),
        ]);

        // Push a rejected promise with a raw string (non-Error) into processingPromises to trigger line 190
        const workerInternal = worker as unknown as {
            processingPromises: Promise<void>[];
        };
        workerInternal.processingPromises.push(Promise.reject("raw rejection in stop"));

        await worker.stop();

        expect(errorEmitter).toHaveBeenCalledWith("raw rejection in stop");
    });

    it("should suppress AbortError during graceful shutdown stop()", async () => {
        const errorEmitter = jest.fn();
        const worker = new Worker("test-queue", processor, mockKodiak);
        worker.on("error", errorEmitter);

        const abortError = new Error("aborted operation");
        abortError.name = "AbortError";

        const workerInternal = worker as unknown as {
            processingPromises: Promise<void>[];
        };
        workerInternal.processingPromises.push(Promise.reject(abortError));

        await worker.stop();

        expect(errorEmitter).not.toHaveBeenCalled();
    });
});
