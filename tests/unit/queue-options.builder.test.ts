import { describe, expect, it } from "vitest";
import {
    QueueOptionsBuilder,
    queueOptions,
} from "../../src/application/dtos/queue-options.builder.js";
import type { IJobSerializer } from "../../src/domain/serializers/job-serializer.interface.js";

describe("QueueOptionsBuilder", () => {
    it("should instantiate with default empty options", () => {
        const builder = queueOptions();
        expect(builder).toBeInstanceOf(QueueOptionsBuilder);
        expect(builder.build()).toEqual({});
    });

    it("should configure serializer and pipelining immutably", () => {
        const dummySerializer: IJobSerializer = {
            serialize: (d) => String(d),
            deserialize: <T>(raw: string | Uint8Array | Buffer) => String(raw) as unknown as T,
        };
        const pipelining = { maxBatch: 25, maxWaitMs: 5 };

        const base = queueOptions();
        const configured = base.serializer(dummySerializer).pipelining(pipelining);

        expect(base.build()).toEqual({});
        expect(configured.build()).toEqual({
            serializer: dummySerializer,
            pipelining,
        });
    });

    it("should configure rateLimiter and limiter alias", () => {
        const rl = { max: 100, duration: 1000, burst: 120 };
        const withRateLimiter = queueOptions().rateLimiter(rl).build();
        expect(withRateLimiter).toEqual({ rateLimiter: rl });

        const withLimiter = queueOptions().limiter(rl).build();
        expect(withLimiter).toEqual({ rateLimiter: rl });
    });

    it("should configure deduplication overloads", () => {
        const autoDedup = queueOptions().deduplicate().build();
        expect(autoDedup).toEqual({ deduplication: true });

        const customDedup = queueOptions().deduplication({ ttl: 60000, strategy: "throw" }).build();
        expect(customDedup).toEqual({
            deduplication: { ttl: 60000, strategy: "throw" },
        });
    });

    it("should configure event flags and disableEvents preset", () => {
        const customEvents = queueOptions()
            .getEvents(false)
            .sendEvents(true)
            .storeJobs(false)
            .build();
        expect(customEvents).toEqual({
            getEvents: false,
            sendEvents: true,
            storeJobs: false,
        });

        const highThroughputPreset = queueOptions().disableEvents().build();
        expect(highThroughputPreset).toEqual({
            getEvents: false,
            sendEvents: false,
            storeJobs: false,
        });
    });

    it("should configure removal lifecycle flags and bulk options", () => {
        const full = queueOptions({ removeOnSuccess: false })
            .removeOnSuccess()
            .removeOnFailure()
            .options({ pipelining: { maxBatch: 10 } })
            .build();

        expect(full).toEqual({
            removeOnSuccess: true,
            removeOnFailure: true,
            pipelining: { maxBatch: 10 },
        });
    });
});
