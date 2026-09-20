import { describe, expect, it, vi } from "vitest";
import { queueOptions } from "../../src/application/dtos/queue-options.builder.js";
import type { IJobSerializer } from "../../src/domain/serializers/job-serializer.interface.js";
import type { Kodiak } from "../../src/presentation/kodiak.js";
import type { Queue } from "../../src/presentation/queue.js";
import { QueueBuilder } from "../../src/presentation/queue-builder.js";

describe("QueueBuilder", () => {
    const createMockKodiak = (): Kodiak => {
        return {
            createQueue: vi.fn((name: string, options) => {
                return {
                    name,
                    options,
                } as unknown as Queue<unknown>;
            }),
        } as unknown as Kodiak;
    };

    const dummySerializer: IJobSerializer = {
        serialize: (data: unknown) => JSON.stringify(data),
        deserialize: <T>(raw: string | Uint8Array | Buffer) =>
            JSON.parse(String(raw)) as unknown as T,
    };

    it("should instantiate with default empty options and delegate to kodiak.createQueue", () => {
        const mockKodiak = createMockKodiak();
        const builder = new QueueBuilder("orders", mockKodiak);

        const queue = builder.create();

        expect(queue.name).toBe("orders");
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("orders", {});
    });

    it("should support build() as an alias for create()", () => {
        const mockKodiak = createMockKodiak();
        const builder = new QueueBuilder("orders", mockKodiak);

        const queue = builder.build();

        expect(queue.name).toBe("orders");
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("orders", {});
    });

    it("should instantiate with initial raw QueueOptions and QueueOptionsBuilder", () => {
        const mockKodiak = createMockKodiak();

        const rawBuilder = new QueueBuilder("raw-queue", mockKodiak, { removeOnSuccess: true });
        rawBuilder.create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith(
            "raw-queue",
            expect.objectContaining({ removeOnSuccess: true }),
        );

        const builderOpts = new QueueBuilder(
            "builder-queue",
            mockKodiak,
            queueOptions().removeOnFailure(true),
        );
        builderOpts.create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith(
            "builder-queue",
            expect.objectContaining({ removeOnFailure: true }),
        );
    });

    it("should configure serializer, pipelining, rateLimiter, and limiter alias", () => {
        const mockKodiak = createMockKodiak();
        const pipelining = { maxBatch: 20, maxWaitMs: 5 };
        const rateLimiter = { max: 100, duration: 1000, burst: 120 };

        const builder = new QueueBuilder("configured", mockKodiak)
            .serializer(dummySerializer)
            .pipelining(pipelining)
            .rateLimiter(rateLimiter);

        builder.create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("configured", {
            serializer: dummySerializer,
            pipelining,
            rateLimiter,
        });

        // Test limiter alias
        const builderWithLimiter = new QueueBuilder("limiter-queue", mockKodiak).limiter(
            rateLimiter,
        );
        builderWithLimiter.create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("limiter-queue", {
            rateLimiter,
        });
    });

    it("should configure deduplication and deduplicate overloads", () => {
        const mockKodiak = createMockKodiak();

        new QueueBuilder("dedup-1", mockKodiak).deduplication(true).create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("dedup-1", {
            deduplication: true,
        });

        new QueueBuilder("dedup-2", mockKodiak).deduplicate().create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("dedup-2", {
            deduplication: true,
        });

        new QueueBuilder("dedup-3", mockKodiak).deduplicate(false).create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("dedup-3", {
            deduplication: false,
        });
    });

    it("should configure events, storeJobs, and disableEvents preset", () => {
        const mockKodiak = createMockKodiak();

        new QueueBuilder("events-default", mockKodiak)
            .getEvents()
            .sendEvents()
            .storeJobs()
            .create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("events-default", {
            getEvents: true,
            sendEvents: true,
            storeJobs: true,
        });

        new QueueBuilder("events-custom", mockKodiak)
            .getEvents(false)
            .sendEvents(false)
            .storeJobs(false)
            .create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("events-custom", {
            getEvents: false,
            sendEvents: false,
            storeJobs: false,
        });

        new QueueBuilder("events-disabled", mockKodiak).disableEvents().create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("events-disabled", {
            getEvents: false,
            sendEvents: false,
            storeJobs: false,
        });
    });

    it("should configure removal lifecycle flags with default and explicit parameters", () => {
        const mockKodiak = createMockKodiak();

        new QueueBuilder("removal-1", mockKodiak).removeOnSuccess().removeOnFailure().create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("removal-1", {
            removeOnSuccess: true,
            removeOnFailure: true,
        });

        new QueueBuilder("removal-2", mockKodiak)
            .removeOnSuccess(false)
            .removeOnFailure(false)
            .create();
        expect(mockKodiak.createQueue).toHaveBeenCalledWith("removal-2", {
            removeOnSuccess: false,
            removeOnFailure: false,
        });
    });

    it("should merge options using partial object and QueueOptionsBuilder", () => {
        const mockKodiak = createMockKodiak();

        new QueueBuilder("options-merge", mockKodiak)
            .options({ storeJobs: false })
            .options(queueOptions().removeOnSuccess())
            .create();

        expect(mockKodiak.createQueue).toHaveBeenCalledWith("options-merge", {
            storeJobs: false,
            removeOnSuccess: true,
        });
    });
});
