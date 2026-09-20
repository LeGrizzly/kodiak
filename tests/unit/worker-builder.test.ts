import { describe, expect, it, vi } from "vitest";
import { workerOptions } from "../../src/application/dtos/worker-options.builder.js";
import type { IJobSerializer } from "../../src/domain/serializers/job-serializer.interface.js";
import type { BackoffStrategy } from "../../src/domain/strategies/backoff.strategy.js";
import type { Kodiak } from "../../src/presentation/kodiak.js";
import type { Worker } from "../../src/presentation/worker.js";
import { WorkerBuilder } from "../../src/presentation/worker-builder.js";

describe("WorkerBuilder", () => {
    const mockWorkerStart = vi.fn().mockResolvedValue(undefined as never);
    const mockWorkerStop = vi.fn().mockResolvedValue(undefined as never);

    const createMockKodiak = (): Kodiak => {
        return {
            createWorker: vi.fn((name: string, processor, options) => {
                return {
                    name,
                    processor,
                    options,
                    start: mockWorkerStart,
                    stop: mockWorkerStop,
                } as unknown as Worker<unknown>;
            }),
        } as unknown as Kodiak;
    };

    const dummySerializer: IJobSerializer = {
        serialize: (data: unknown) => JSON.stringify(data),
        deserialize: <T>(raw: string | Uint8Array | Buffer) =>
            JSON.parse(String(raw)) as unknown as T,
    };

    it("should throw error if create() or build() is called without a processor", () => {
        const mockKodiak = createMockKodiak();
        const builder = new WorkerBuilder("no-handler", mockKodiak);

        expect(() => builder.create()).toThrow(
            'Worker for queue "no-handler" requires a processor function. Call .handler(fn) or .process(fn) before creating.',
        );
        expect(() => builder.build()).toThrow(
            'Worker for queue "no-handler" requires a processor function. Call .handler(fn) or .process(fn) before creating.',
        );
    });

    it("should create worker using handler or process alias and build() alias", () => {
        const mockKodiak = createMockKodiak();
        const processor1 = vi.fn(async () => {});
        const processor2 = vi.fn(async () => {});

        const worker1 = new WorkerBuilder("w-1", mockKodiak).handler(processor1).create();
        expect(mockKodiak.createWorker).toHaveBeenCalledWith("w-1", processor1, {});
        expect(worker1).toBeDefined();

        const worker2 = new WorkerBuilder("w-2", mockKodiak).process(processor2).build();
        expect(mockKodiak.createWorker).toHaveBeenCalledWith("w-2", processor2, {});
        expect(worker2).toBeDefined();
    });

    it("should instantiate with initial raw WorkerOptions and WorkerOptionsBuilder", () => {
        const mockKodiak = createMockKodiak();
        const processor = vi.fn(async () => {});

        const rawBuilder = new WorkerBuilder("w-raw", mockKodiak, { concurrency: 5 }).handler(
            processor,
        );
        rawBuilder.create();
        expect(mockKodiak.createWorker).toHaveBeenCalledWith(
            "w-raw",
            processor,
            expect.objectContaining({ concurrency: 5 }),
        );

        const builderOpts = new WorkerBuilder(
            "w-builder",
            mockKodiak,
            workerOptions().concurrency(10),
        ).handler(processor);
        builderOpts.create();
        expect(mockKodiak.createWorker).toHaveBeenCalledWith(
            "w-builder",
            processor,
            expect.objectContaining({ concurrency: 10 }),
        );
    });

    it("should configure concurrency, prefetch overloads, ackPipelining, and lockDuration", () => {
        const mockKodiak = createMockKodiak();
        const processor = vi.fn(async () => {});

        new WorkerBuilder("tune-1", mockKodiak)
            .handler(processor)
            .concurrency(15)
            .prefetch("auto")
            .ackPipelining(true)
            .lockDuration(45000)
            .create();

        expect(mockKodiak.createWorker).toHaveBeenCalledWith("tune-1", processor, {
            concurrency: 15,
            prefetch: "auto",
            ackPipelining: true,
            lockDuration: 45000,
        });

        new WorkerBuilder("tune-2", mockKodiak)
            .handler(processor)
            .prefetch({ min: 5, max: 25 })
            .ackPipelining({ maxBatch: 30, maxWaitMs: 3 })
            .create();

        expect(mockKodiak.createWorker).toHaveBeenCalledWith("tune-2", processor, {
            prefetch: { min: 5, max: 25 },
            ackPipelining: { maxBatch: 30, maxWaitMs: 3 },
        });
    });

    it("should configure gracefulShutdown, heartbeat, and backoffStrategy overloads", () => {
        const mockKodiak = createMockKodiak();
        const processor = vi.fn(async () => {});
        const strat1: BackoffStrategy = (att, delay) => att * delay;
        const strat2: BackoffStrategy = (_att, delay) => delay + 50;

        new WorkerBuilder("resilience-1", mockKodiak)
            .handler(processor)
            .gracefulShutdownTimeout(10000)
            .gracefulShutdown(12000)
            .heartbeat(true, 4000)
            .heartbeatEnabled(true)
            .heartbeatInterval(3000)
            .backoffStrategy("strat1", strat1)
            .backoffStrategies({ strat2 })
            .create();

        expect(mockKodiak.createWorker).toHaveBeenCalledWith(
            "resilience-1",
            processor,
            expect.objectContaining({
                gracefulShutdownTimeout: 12000,
                heartbeatEnabled: true,
                heartbeatInterval: 3000,
                backoffStrategies: {
                    strat1,
                    strat2,
                },
            }),
        );
    });

    it("should configure serializer, telemetry, credits, events, storeJobs, and removal flags", () => {
        const mockKodiak = createMockKodiak();
        const processor = vi.fn(async () => {});

        // Defaults (true)
        new WorkerBuilder("flags-default", mockKodiak)
            .handler(processor)
            .serializer(dummySerializer)
            .telemetry()
            .credits(20)
            .sendEvents()
            .storeJobs()
            .removeOnSuccess()
            .removeOnFailure()
            .create();

        expect(mockKodiak.createWorker).toHaveBeenCalledWith("flags-default", processor, {
            serializer: dummySerializer,
            telemetry: true,
            credits: 20,
            sendEvents: true,
            storeJobs: true,
            removeOnSuccess: true,
            removeOnFailure: true,
        });

        // Explicit false & object credits
        new WorkerBuilder("flags-explicit", mockKodiak)
            .handler(processor)
            .telemetry(false)
            .credits({ maxCredits: 50, replenishBatchThreshold: 10 })
            .sendEvents(false)
            .storeJobs(false)
            .removeOnSuccess(false)
            .removeOnFailure(false)
            .create();

        expect(mockKodiak.createWorker).toHaveBeenCalledWith("flags-explicit", processor, {
            telemetry: false,
            credits: { maxCredits: 50, replenishBatchThreshold: 10 },
            sendEvents: false,
            storeJobs: false,
            removeOnSuccess: false,
            removeOnFailure: false,
        });
    });

    it("should merge options using partial object and WorkerOptionsBuilder", () => {
        const mockKodiak = createMockKodiak();
        const processor = vi.fn(async () => {});

        new WorkerBuilder("options-merge", mockKodiak)
            .handler(processor)
            .options({ concurrency: 2, lockDuration: 10000 })
            .options(workerOptions().concurrency(4))
            .create();

        expect(mockKodiak.createWorker).toHaveBeenCalledWith("options-merge", processor, {
            concurrency: 4,
            lockDuration: 10000,
        });
    });

    it("should start worker using start() method", async () => {
        const mockKodiak = createMockKodiak();
        const processor = vi.fn(async () => {});

        const builder = new WorkerBuilder("start-worker", mockKodiak).handler(processor);
        const worker = await builder.start();

        expect(worker).toBeDefined();
        expect(mockWorkerStart).toHaveBeenCalledTimes(1);
    });
});
