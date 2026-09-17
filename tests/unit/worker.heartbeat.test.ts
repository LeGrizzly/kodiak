import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, type MockedFunction, vi } from "vitest";
import type { Kodiak } from "../../src/presentation/kodiak.js";

const mockExtendLock = vi.fn();
const mockFetchExecute = vi.fn();

vi.doMock("../../src/infrastructure/dragonfly/dragonfly-queue.repository.js", () => ({
    DragonflyQueueRepository: vi.fn(function MockDragonflyQueueRepository() {
        return {
            updateProgress: vi.fn(),
            fetchNextJobs: vi.fn(),
            extendLock: mockExtendLock,
            markAsFailed: vi.fn().mockResolvedValue(undefined as never),
            markAsCompleted: vi.fn().mockResolvedValue(undefined as never),
        };
    }),
}));

vi.doMock("../../src/application/use-cases/fetch-jobs.use-case.js", () => ({
    FetchJobsUseCase: vi.fn(function MockFetchJobsUseCase() {
        return {
            execute: mockFetchExecute,
        };
    }),
}));

const { Worker } = await import("../../src/presentation/worker.js");

describe("Worker heartbeat", () => {
    let mockKodiak: Kodiak;
    let processor: MockedFunction<(job: unknown) => Promise<void>>;

    beforeEach(() => {
        mockExtendLock.mockReset();
        mockFetchExecute.mockReset();

        const mockRedisConnection = {
            duplicate: vi.fn().mockReturnThis(),
            quit: vi.fn(),
            disconnect: vi.fn(),
            brpop: vi.fn(),
        };

        mockKodiak = {
            connection: mockRedisConnection as unknown as Redis,
            prefix: "kodiak-test",
        } as unknown as Kodiak;
        processor = vi.fn() as MockedFunction<(job: unknown) => Promise<void>>;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("calls extendLock periodically when heartbeatEnabled", async () => {
        vi.useRealTimers();

        const job = {
            id: "hb-job",
            data: { foo: "bar" },
            priority: 1,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
            status: "active",
            updateProgress: async () => {},
        };

        // first call returns one job, then no jobs
        mockFetchExecute.mockResolvedValueOnce([job] as never).mockResolvedValueOnce([] as never);

        processor.mockImplementation(async () => {
            return new Promise((resolve) => setTimeout(resolve, 50));
        });

        const worker = new Worker("test-queue", processor, mockKodiak, {
            heartbeatEnabled: true,
            heartbeatInterval: 10,
            lockDuration: 100,
            concurrency: 1,
        });

        await worker.start();

        // wait enough time for the heartbeat to trigger at least once
        await new Promise((resolve) => setTimeout(resolve, 120));

        await worker.stop();

        expect(mockExtendLock).toHaveBeenCalled();
        const callArgs = mockExtendLock.mock.calls[0] as [string, number, string];
        expect(callArgs?.[0]).toBe("hb-job");
        expect(typeof callArgs?.[1]).toBe("number");
        expect(typeof callArgs?.[2]).toBe("string");
    });

    it("emits error when extendLock throws inside heartbeat", async () => {
        vi.useRealTimers();

        const job = {
            id: "hb-job",
            data: { foo: "bar" },
            priority: 1,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
            status: "active",
            updateProgress: async () => {},
        };

        mockFetchExecute.mockResolvedValueOnce([job] as never).mockResolvedValueOnce([] as never);

        const testError = new Error("heartbeat error");
        mockExtendLock.mockRejectedValueOnce(testError as never);

        processor.mockImplementation(async () => {
            return new Promise((resolve) => setTimeout(resolve, 50));
        });

        const worker = new Worker("test-queue", processor, mockKodiak, {
            heartbeatEnabled: true,
            heartbeatInterval: 10,
            lockDuration: 100,
            concurrency: 1,
        });

        const errorEmitter = vi.fn();
        worker.on("error", errorEmitter);

        await worker.start();

        await new Promise((resolve) => setTimeout(resolve, 120));

        await worker.stop();

        expect(errorEmitter).toHaveBeenCalledWith(testError);
    });

    it("uses default lockDuration and heartbeatInterval when heartbeatEnabled is true", async () => {
        const job = {
            id: "hb-default-job",
            data: { foo: "bar" },
            priority: 1,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
            status: "active",
            updateProgress: async () => {},
        };

        mockFetchExecute.mockResolvedValueOnce([job] as never).mockResolvedValueOnce([] as never);

        processor.mockImplementation(async () => {
            return new Promise((resolve) => setTimeout(resolve, 20));
        });

        const worker = new Worker("test-queue", processor, mockKodiak, {
            heartbeatEnabled: true,
            concurrency: 1,
        });

        await worker.start();
        await new Promise((resolve) => setTimeout(resolve, 40));
        await worker.stop();

        expect(processor).toHaveBeenCalled();
    });
});
