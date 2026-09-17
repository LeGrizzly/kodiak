import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Redis } from "ioredis";
import type { IJobSerializer } from "../../src/domain/serializers/job-serializer.interface.js";
import type { TaskDefinition } from "../../src/presentation/task.js";
import type { WorkerProcessor } from "../../src/presentation/worker.js";

const mockQuit = jest.fn().mockResolvedValue(undefined as never);
const mockRawClient = {
    duplicate: jest.fn(),
    quit: mockQuit,
} as unknown as Redis;
const mockGetRawClient = jest.fn().mockReturnValue(mockRawClient);

jest.unstable_mockModule("../../src/infrastructure/dragonfly/dragonfly-connection.js", () => ({
    DragonflyConnection: jest.fn().mockImplementation(() => ({
        getRawClient: mockGetRawClient,
        quit: mockQuit,
        disconnect: jest.fn(),
        duplicate: jest.fn(),
    })),
}));

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn().mockResolvedValue(undefined as never);
const mockQueueConstructor = jest.fn();
jest.unstable_mockModule("../../src/presentation/queue.js", () => ({
    Queue: jest.fn().mockImplementation((...args: unknown[]) => {
        mockQueueConstructor(...args);
        return {
            add: mockQueueAdd,
            close: mockQueueClose,
        };
    }),
}));

const mockWorkerConstructor = jest.fn();
jest.unstable_mockModule("../../src/presentation/worker.js", () => ({
    Worker: jest.fn().mockImplementation((...args: unknown[]) => {
        mockWorkerConstructor(...args);
        return {
            start: jest.fn(),
            stop: jest.fn(),
        };
    }),
}));

const { Kodiak } = await import("../../src/presentation/kodiak.js");
const { MsgpackJobSerializer } = await import(
    "../../src/infrastructure/serializers/msgpack-job.serializer.js"
);

describe("Kodiak Facade", () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

        const processor: WorkerProcessor<unknown> = jest.fn(async () => {});
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
        const processor: WorkerProcessor<string> = jest.fn(async () => {});

        kodiak.worker(taskDef, processor, { concurrency: 2 });

        expect(mockWorkerConstructor).toHaveBeenCalledWith("typed-task", processor, kodiak, {
            concurrency: 2,
        });
    });

    it("should close dragonflyConnection on close()", async () => {
        const kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
        });

        await kodiak.close();
        expect(mockQuit).toHaveBeenCalledTimes(1);
    });
});
