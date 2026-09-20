import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobOptions } from "../../src/application/dtos/job-options.builder.js";
import { queueOptions } from "../../src/application/dtos/queue-options.builder.js";
import { workerOptions } from "../../src/application/dtos/worker-options.builder.js";
import type { Job } from "../../src/domain/entities/job.entity.js";
import type { Kodiak as KodiakType } from "../../src/presentation/kodiak.js";
import { task } from "../../src/presentation/task.js";

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

import { JobBuilder } from "../../src/presentation/job-builder.js";

const mockQueueAdd = vi.fn();
const mockQueueClose = vi.fn().mockResolvedValue(undefined as never);
const mockQueueConstructor = vi.fn();
vi.doMock("../../src/presentation/queue.js", async () => {
    const actual = await vi.importActual<typeof import("../../src/presentation/queue.js")>(
        "../../src/presentation/queue.js",
    );
    return {
        ...actual,
        Queue: vi.fn(function MockQueue(this: unknown, ...args: unknown[]) {
            mockQueueConstructor(...args);
            return {
                name: args[0],
                add: mockQueueAdd,
                close: mockQueueClose,
                job: (id: string, data: unknown) => {
                    return new JobBuilder(id, data, { add: mockQueueAdd });
                },
            };
        }),
    };
});

const mockWorkerStart = vi.fn().mockResolvedValue(undefined as never);
const mockWorkerStop = vi.fn().mockResolvedValue(undefined as never);
const mockWorkerConstructor = vi.fn();
vi.doMock("../../src/presentation/worker.js", () => ({
    Worker: vi.fn(function MockWorker(...args: unknown[]) {
        mockWorkerConstructor(...args);
        return {
            start: mockWorkerStart,
            stop: mockWorkerStop,
        };
    }),
}));

const { Kodiak } = await import("../../src/presentation/kodiak.js");

describe("Fluent Entity Builders", () => {
    let kodiak: KodiakType;

    beforeEach(() => {
        vi.clearAllMocks();
        kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
            prefix: "fluent-test",
        });
    });

    it("should build and create a Queue using queueBuilder", () => {
        const rateLimiter = { max: 50, duration: 1000 };
        const queue = kodiak
            .queueBuilder<{ email: string }>("emails")
            .removeOnSuccess()
            .rateLimiter(rateLimiter)
            .create();

        expect(queue).toBeDefined();
        expect(mockQueueConstructor).toHaveBeenCalledWith(
            "emails",
            kodiak,
            undefined,
            expect.objectContaining({
                removeOnSuccess: true,
                rateLimiter,
            }),
        );
    });

    it("should accept QueueOptionsBuilder directly in createQueue", () => {
        const qOpts = queueOptions().removeOnSuccess().removeOnFailure();
        kodiak.createQueue("reports", qOpts);

        expect(mockQueueConstructor).toHaveBeenCalledWith(
            "reports",
            kodiak,
            undefined,
            expect.objectContaining({
                removeOnSuccess: true,
                removeOnFailure: true,
            }),
        );
    });

    it("should build, create, and optionally start a Worker using workerBuilder", async () => {
        const processor = vi.fn(async () => {});

        // 1. workerBuilder with .create()
        const worker1 = kodiak
            .workerBuilder<{ id: string }>("jobs")
            .handler(processor)
            .concurrency(10)
            .heartbeat(true, 5000)
            .prefetch(20)
            .create();

        expect(worker1).toBeDefined();
        expect(mockWorkerConstructor).toHaveBeenCalledWith(
            "jobs",
            processor,
            kodiak,
            expect.objectContaining({
                concurrency: 10,
                heartbeatEnabled: true,
                heartbeatInterval: 5000,
                prefetch: 20,
            }),
        );

        // 2. workerBuilder with .process alias and .start()
        const worker2 = await kodiak
            .workerBuilder<{ id: string }>("jobs-2")
            .process(processor)
            .concurrency(5)
            .start();

        expect(worker2).toBeDefined();
        expect(mockWorkerStart).toHaveBeenCalledTimes(1);
    });

    it("should throw error if workerBuilder create() is called without handler", () => {
        expect(() => {
            kodiak.workerBuilder("no-handler-queue").concurrency(5).create();
        }).toThrow(/requires a processor function/i);
    });

    it("should accept WorkerOptionsBuilder directly in createWorker", () => {
        const processor = vi.fn(async () => {});
        const wOpts = workerOptions().concurrency(8).telemetry(true);

        kodiak.createWorker("heavy", processor, wOpts);

        expect(mockWorkerConstructor).toHaveBeenCalledWith(
            "heavy",
            processor,
            kodiak,
            expect.objectContaining({
                concurrency: 8,
                telemetry: true,
            }),
        );
    });

    it("should accept JobOptionsBuilder in kodiak.push", async () => {
        const myTask = task<{ message: string }>("log-message");
        const jOpts = jobOptions().priority(10).attempts(3);

        mockQueueAdd.mockResolvedValueOnce({ id: "job-100" } as Job<{ message: string }>);

        await kodiak.push(myTask, { message: "hello" }, jOpts);

        expect(mockQueueAdd).toHaveBeenCalledWith(
            expect.any(String),
            { message: "hello" },
            expect.objectContaining({
                priority: 10,
                attempts: 3,
            }),
        );
    });

    it("should build and add job fluently using JobBuilder", async () => {
        const queue = kodiak.createQueue<{ count: number }>("counter");
        mockQueueAdd.mockResolvedValueOnce({ id: "count-1" } as Job<{ count: number }>);

        const scheduled = new Date("2026-12-01T00:00:00Z");
        const job = await queue
            .job("count-1", { count: 42 })
            .priority(5)
            .delay(1000)
            .waitUntil(scheduled)
            .attempts(3)
            .backoff("exponential", 500)
            .deduplicate()
            .removeOnSuccess()
            .add();

        expect(mockQueueAdd).toHaveBeenCalledWith(
            "count-1",
            { count: 42 },
            {
                priority: 5,
                delay: 1000,
                waitUntil: scheduled,
                attempts: 3,
                backoff: { type: "exponential", delay: 500 },
                deduplication: true,
                removeOnSuccess: true,
            },
        );
        expect(job).toEqual({ id: "count-1" });
    });
});
