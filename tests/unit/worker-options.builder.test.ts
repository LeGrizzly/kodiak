import { describe, expect, it } from "vitest";
import {
    resolveWorkerOptions,
    WorkerOptionsBuilder,
    workerOptions,
} from "../../src/application/dtos/worker-options.builder.js";
import type { IJobSerializer } from "../../src/domain/serializers/job-serializer.interface.js";
import type { BackoffStrategy } from "../../src/domain/strategies/backoff.strategy.js";

describe("WorkerOptionsBuilder", () => {
    it("should instantiate with default empty options", () => {
        const builder = workerOptions();
        expect(builder).toBeInstanceOf(WorkerOptionsBuilder);
        expect(builder.build()).toEqual({});
    });

    it("should instantiate with another WorkerOptionsBuilder", () => {
        const initial = workerOptions().concurrency(3);
        const copied = new WorkerOptionsBuilder(initial);
        expect(copied.build()).toEqual({ concurrency: 3 });
    });

    it("should correctly resolve worker options via resolveWorkerOptions helper", () => {
        expect(resolveWorkerOptions(undefined)).toBeUndefined();
        expect(resolveWorkerOptions({ concurrency: 5 })).toEqual({ concurrency: 5 });
        expect(resolveWorkerOptions(workerOptions().concurrency(5))).toEqual({ concurrency: 5 });
    });

    it("should configure concurrency, prefetch, and ackPipelining", () => {
        const configured = workerOptions()
            .concurrency(10)
            .prefetch({ min: 10, max: 100 })
            .ackPipelining({ maxBatch: 50, maxWaitMs: 2 })
            .build();

        expect(configured).toEqual({
            concurrency: 10,
            prefetch: { min: 10, max: 100 },
            ackPipelining: { maxBatch: 50, maxWaitMs: 2 },
        });
    });

    it("should configure lockDuration and gracefulShutdown aliases", () => {
        const withTimeout = workerOptions().lockDuration(60000).gracefulShutdown(15000).build();

        expect(withTimeout).toEqual({
            lockDuration: 60000,
            gracefulShutdownTimeout: 15000,
        });

        const withExplicit = workerOptions().gracefulShutdownTimeout(20000).build();
        expect(withExplicit.gracefulShutdownTimeout).toBe(20000);
    });

    it("should configure heartbeat overloads", () => {
        const autoInterval = workerOptions().heartbeat(true).build();
        expect(autoInterval).toEqual({
            heartbeatEnabled: true,
            heartbeatInterval: undefined,
        });

        const customInterval = workerOptions().heartbeat(true, 5000).build();
        expect(customInterval).toEqual({
            heartbeatEnabled: true,
            heartbeatInterval: 5000,
        });

        const separateCalls = workerOptions()
            .heartbeatEnabled(true)
            .heartbeatInterval(3000)
            .build();
        expect(separateCalls).toEqual({
            heartbeatEnabled: true,
            heartbeatInterval: 3000,
        });
    });

    it("should configure backoff strategies", () => {
        const linearStrategy: BackoffStrategy = (attempts, delay) => attempts * delay;
        const jitterStrategy: BackoffStrategy = (_attempts, delay) => delay + 100;

        const single = workerOptions().backoffStrategy("linear", linearStrategy).build();
        expect(single.backoffStrategies).toEqual({ linear: linearStrategy });

        const merged = workerOptions()
            .backoffStrategy("linear", linearStrategy)
            .backoffStrategies({ jitter: jitterStrategy })
            .build();
        expect(merged.backoffStrategies).toEqual({
            linear: linearStrategy,
            jitter: jitterStrategy,
        });
    });

    it("should configure credits, rateLimiter, limiter alias, telemetry, serializer, and lifecycle flags", () => {
        const dummySerializer: IJobSerializer = {
            serialize: (d) => String(d),
            deserialize: <T>(raw: string | Uint8Array | Buffer) => String(raw) as unknown as T,
        };
        const rl = { max: 50, duration: 1000 };

        const full = workerOptions()
            .credits(25)
            .rateLimiter(rl)
            .telemetry(true)
            .serializer(dummySerializer)
            .removeOnSuccess()
            .removeOnFailure(false)
            .sendEvents(false)
            .storeJobs(false)
            .build();

        expect(full).toEqual({
            credits: 25,
            rateLimiter: rl,
            telemetry: true,
            serializer: dummySerializer,
            removeOnSuccess: true,
            removeOnFailure: false,
            sendEvents: false,
            storeJobs: false,
        });

        // Test limiter alias, options with object & builder, and default arguments
        const withLimiter = workerOptions()
            .limiter(rl)
            .telemetry()
            .sendEvents()
            .storeJobs()
            .removeOnFailure()
            .options({ concurrency: 8 })
            .options(workerOptions().concurrency(16))
            .build();

        expect(withLimiter).toEqual({
            rateLimiter: rl,
            telemetry: true,
            sendEvents: true,
            storeJobs: true,
            removeOnFailure: true,
            concurrency: 16,
        });
    });
});
