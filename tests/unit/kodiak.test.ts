import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IJobSerializer } from "../../src/domain/serializers/job-serializer.interface.js";
import type { TaskDefinition } from "../../src/presentation/task.js";
import type { WorkerProcessor } from "../../src/presentation/worker.js";

const mockQuit = vi.fn().mockResolvedValue(undefined as never);
const mockRawClient = {
    duplicate: vi.fn(),
    quit: mockQuit,
} as unknown as Redis;
const mockGetRawClient = vi.fn().mockReturnValue(mockRawClient);

vi.doMock("../../src/infrastructure/dragonfly/dragonfly-connection.js", () => ({
    DragonflyConnection: vi.fn(function MockDragonflyConnection() {
        return {
            getRawClient: mockGetRawClient,
            quit: mockQuit,
            disconnect: vi.fn(),
            duplicate: vi.fn(),
        };
    }),
}));

const mockQueueAdd = vi.fn();
const mockQueueClose = vi.fn().mockResolvedValue(undefined as never);
const mockQueueConstructor = vi.fn();
vi.doMock("../../src/presentation/queue.js", () => ({
    Queue: vi.fn(function MockQueue(...args: unknown[]) {
        mockQueueConstructor(...args);
        return {
            add: mockQueueAdd,
            close: mockQueueClose,
        };
    }),
}));

const mockWorkerConstructor = vi.fn();
vi.doMock("../../src/presentation/worker.js", () => ({
    Worker: vi.fn(function MockWorker(...args: unknown[]) {
        mockWorkerConstructor(...args);
        return {
            start: vi.fn(),
            stop: vi.fn(),
        };
    }),
}));

const { Kodiak } = await import("../../src/presentation/kodiak.js");
const { MsgpackJobSerializer } = await import(
    "../../src/infrastructure/serializers/msgpack-job.serializer.js"
);

describe("Kodiak Facade", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should initialize with default prefix, serializer, and undefined pipelining", () => {
        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
        });

        expect(kodiak.prefix).toBe("kodiak");
        expect(kodiak.serializer).toBeInstanceOf(MsgpackJobSerializer);
        expect(kodiak.pipelining).toBeUndefined();
        expect(kodiak.connection).toBe(mockRawClient);
    });

    it("should initialize with custom prefix, serializer, and pipelining options", () => {
        const customSerializer: IJobSerializer = {
            serialize: (d) => String(d),
            deserialize: <T>(raw: string | Uint8Array | Buffer) => String(raw) as unknown as T,
        };
        const pipelining = { maxBatch: 25, maxWaitMs: 10 };

        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
            prefix: "custom-app",
            serializer: customSerializer,
            pipelining,
        });

        expect(kodiak.prefix).toBe("custom-app");
        expect(kodiak.serializer).toBe(customSerializer);
        expect(kodiak.pipelining).toEqual(pipelining);
    });

    it("should create queue with defaults and custom options", () => {
        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
            prefix: "test-app",
        });

        // 1. Queue with default serializer and pipelining from kodiak instance
        kodiak.createQueue("default-queue");
        expect(mockQueueConstructor).toHaveBeenCalledWith(
            "default-queue",
            kodiak,
            undefined,
            kodiak.serializer,
            undefined,
        );

        // 2. Queue with overridden serializer and pipelining
        const overrideSerializer: IJobSerializer = {
            serialize: (d) => String(d),
            deserialize: <T>(raw: string | Uint8Array | Buffer) => String(raw) as unknown as T,
        };
        const overridePipelining = { maxBatch: 5 };
        kodiak.createQueue("custom-queue", {
            serializer: overrideSerializer,
            pipelining: overridePipelining,
        });

        expect(mockQueueConstructor).toHaveBeenCalledWith(
            "custom-queue",
            kodiak,
            undefined,
            overrideSerializer,
            overridePipelining,
        );
    });

    it("should create worker and forward processor and options", () => {
        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
        });

        const processor: WorkerProcessor<unknown> = vi.fn(async () => {});
        const workerOpts = { concurrency: 4, heartbeatEnabled: false };

        kodiak.createWorker("jobs-queue", processor, workerOpts);

        expect(mockWorkerConstructor).toHaveBeenCalledWith(
            "jobs-queue",
            processor,
            kodiak,
            workerOpts,
        );
    });

    it("should push task with function schema, parse schema, and no schema", async () => {
        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
        });

        // 1. task with function schema
        const fnSchemaTask: TaskDefinition<{ email: string }> = {
            name: "email-queue",
            schema: (data: unknown) => {
                const d = data as { email: string };
                return { email: d.email.toLowerCase() };
            },
            options: { priority: 2 },
        };
        mockQueueAdd.mockResolvedValueOnce({ id: "job-1" } as never);

        await kodiak.push(fnSchemaTask, { email: "TEST@EXAMPLE.COM" }, { attempts: 5 });

        expect(mockQueueAdd).toHaveBeenCalledWith(
            expect.any(String),
            { email: "test@example.com" },
            { priority: 2, attempts: 5 },
        );

        // 2. task with object parse schema
        const objSchemaTask: TaskDefinition<{ count: number }> = {
            name: "count-queue",
            schema: {
                parse: (data: unknown) => {
                    const d = data as { count: number };
                    return { count: d.count * 2 };
                },
            },
        };
        mockQueueAdd.mockResolvedValueOnce({ id: "job-2" } as never);

        await kodiak.push(objSchemaTask, { count: 10 });

        expect(mockQueueAdd).toHaveBeenCalledWith(expect.any(String), { count: 20 }, {});

        // 3. task without schema
        const rawTask: TaskDefinition<string> = {
            name: "raw-queue",
        };
        mockQueueAdd.mockResolvedValueOnce({ id: "job-3" } as never);

        await kodiak.push(rawTask, "plain-data");

        expect(mockQueueAdd).toHaveBeenCalledWith(expect.any(String), "plain-data", {});
    });

    it("should instantiate worker via task definition helper", () => {
        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
        });

        const taskDef: TaskDefinition<string> = {
            name: "typed-task",
            options: { priority: 1 },
        };
        const processor: WorkerProcessor<string> = vi.fn(async () => {});

        kodiak.worker(taskDef, processor, { concurrency: 2 });

        expect(mockWorkerConstructor).toHaveBeenCalledWith("typed-task", processor, kodiak, {
            concurrency: 2,
        });
    });

    it("should inherit rateLimiter from queue configuration when creating worker", () => {
        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
        });

        const rateLimiter = { max: 10, duration: 1000, burst: 20 };
        kodiak.createQueue("rate-limited-queue", { rateLimiter });

        const processor: WorkerProcessor<unknown> = vi.fn(async () => {});
        kodiak.createWorker("rate-limited-queue", processor, { concurrency: 3 });

        expect(mockWorkerConstructor).toHaveBeenCalledWith(
            "rate-limited-queue",
            processor,
            kodiak,
            { concurrency: 3, rateLimiter },
        );
    });

    it("should close dragonflyConnection on close()", async () => {
        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
        });

        await kodiak.close();
        expect(mockQuit).toHaveBeenCalledTimes(1);
    });
});
