import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueOptions } from "../../src/application/dtos/queue-options.dto.js";
import type { WorkerOptions } from "../../src/application/dtos/worker-options.dto.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";
import { Kodiak } from "../../src/presentation/kodiak.js";
import { Queue } from "../../src/presentation/queue.js";
import type { WorkerProcessor } from "../../src/presentation/worker.js";

describe("Unit: Queue Options (Events & Redis Key Removal)", () => {
    let mockRedis: { duplicate: ReturnType<typeof vi.fn>; quit: ReturnType<typeof vi.fn> };
    let mockKodiak: Kodiak;
    let mockRepository: IQueueRepository<{ task: string }>;

    beforeEach(() => {
        mockRedis = {
            duplicate: vi.fn().mockReturnThis(),
            quit: vi.fn().mockResolvedValue("OK"),
        };

        mockKodiak = {
            connection: mockRedis as unknown as Redis,
            prefix: "kodiak-test",
            serializer: {
                serialize: vi.fn().mockReturnValue("serialized"),
                deserialize: vi.fn(),
            },
        } as unknown as Kodiak;

        mockRepository = {
            add: vi.fn().mockResolvedValue({ isDuplicate: false, jobId: "job-1" }),
            fetchNext: vi.fn(),
            fetchNextJobs: vi.fn(),
            markAsCompleted: vi.fn(),
            markAsFailed: vi.fn(),
            updateProgress: vi.fn(),
            promoteDelayedJobs: vi.fn().mockResolvedValue(0),
            recoverStalledJobs: vi.fn().mockResolvedValue([]),
            extendLock: vi.fn(),
            releaseJobs: vi.fn(),
        } as unknown as IQueueRepository<{ task: string }>;
    });

    it("should resolve default options when no custom options are provided", async () => {
        const queue = new Queue<{ task: string }>("default-opt-queue", mockKodiak, mockRepository);

        expect(queue.options).toBeDefined();
        expect(queue.options.getEvents ?? true).toBe(true);
        expect(queue.options.sendEvents ?? true).toBe(true);
        expect(queue.options.storeJobs ?? true).toBe(true);
        expect(queue.options.removeOnSuccess ?? false).toBe(false);
        expect(queue.options.removeOnFailure ?? false).toBe(false);

        await queue.close();
    });

    it("should retain custom options when passed in constructor", async () => {
        const customOptions: QueueOptions = {
            getEvents: false,
            sendEvents: false,
            storeJobs: false,
            removeOnSuccess: true,
            removeOnFailure: true,
        };

        const queue = new Queue<{ task: string }>(
            "custom-opt-queue",
            mockKodiak,
            mockRepository,
            customOptions,
        );

        expect(queue.options).toBeDefined();
        expect(queue.options.getEvents).toBe(false);
        expect(queue.options.sendEvents).toBe(false);
        expect(queue.options.storeJobs).toBe(false);
        expect(queue.options.removeOnSuccess).toBe(true);
        expect(queue.options.removeOnFailure).toBe(true);

        await queue.close();
    });

    it("should propagate queue options to worker in Kodiak facade", () => {
        const mockRawClient = {
            duplicate: vi.fn().mockReturnThis(),
            quit: vi.fn().mockResolvedValue(undefined),
        } as unknown as Redis;

        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
        });
        // Override connection for safety in unit tests
        (kodiak as unknown as { connection: Redis }).connection = mockRawClient;

        kodiak.createQueue("orders", {
            getEvents: false,
            sendEvents: false,
            storeJobs: false,
            removeOnSuccess: true,
            removeOnFailure: true,
        });

        const processor: WorkerProcessor<{ orderId: string }> = vi.fn(async () => {});
        const worker = kodiak.createWorker("orders", processor);

        // Verify inherited worker options
        const workerOpts = (worker as unknown as { opts?: WorkerOptions }).opts;
        expect(workerOpts?.sendEvents).toBe(false);
        expect(workerOpts?.storeJobs).toBe(false);
        expect(workerOpts?.removeOnSuccess).toBe(true);
        expect(workerOpts?.removeOnFailure).toBe(true);
    });

    it("should allow worker options to override inherited queue options", () => {
        const mockRawClient = {
            duplicate: vi.fn().mockReturnThis(),
            quit: vi.fn().mockResolvedValue(undefined),
        } as unknown as Redis;

        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
        });
        (kodiak as unknown as { connection: Redis }).connection = mockRawClient;

        kodiak.createQueue("reports", {
            removeOnSuccess: true,
            sendEvents: false,
        });

        const processor: WorkerProcessor<{ reportId: string }> = vi.fn(async () => {});
        const worker = kodiak.createWorker("reports", processor, {
            removeOnSuccess: false, // override
            sendEvents: true, // override
        });

        const workerOpts = (worker as unknown as { opts?: WorkerOptions }).opts;
        expect(workerOpts?.removeOnSuccess).toBe(false);
        expect(workerOpts?.sendEvents).toBe(true);
    });
});
