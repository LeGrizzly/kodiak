import { describe, expect, it, vi } from "vitest";
import { jobOptions } from "../../src/application/dtos/job-options.builder.js";
import type { Job } from "../../src/domain/entities/job.entity.js";
import { type IJobQueueTarget, JobBuilder } from "../../src/presentation/job-builder.js";

describe("JobBuilder", () => {
    interface TestPayload {
        task: string;
        priorityScore: number;
    }

    const createMockQueue = (): IJobQueueTarget<TestPayload> => ({
        add: vi.fn(async (id: string, data: TestPayload, options) => {
            return {
                id,
                data,
                opts: options,
            } as unknown as Job<TestPayload>;
        }),
    });

    it("should instantiate with default empty options and delegate to queue.add", async () => {
        const mockQueue = createMockQueue();
        const builder = new JobBuilder("job-1", { task: "clean", priorityScore: 1 }, mockQueue);

        const job = await builder.add();

        expect(job.id).toBe("job-1");
        expect(mockQueue.add).toHaveBeenCalledWith(
            "job-1",
            { task: "clean", priorityScore: 1 },
            {},
        );
    });

    it("should initialize with initial raw JobOptions and JobOptionsBuilder", async () => {
        const mockQueue = createMockQueue();
        const rawOptsBuilder = new JobBuilder(
            "job-raw",
            { task: "index", priorityScore: 2 },
            mockQueue,
            { priority: 10 },
        );
        await rawOptsBuilder.add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "job-raw",
            { task: "index", priorityScore: 2 },
            { priority: 10 },
        );

        const builderOptsBuilder = new JobBuilder(
            "job-builder-opt",
            { task: "index", priorityScore: 2 },
            mockQueue,
            jobOptions().priority(20),
        );
        await builderOptsBuilder.add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "job-builder-opt",
            { task: "index", priorityScore: 2 },
            { priority: 20 },
        );
    });

    it("should configure priority, delay, waitUntil, attempts, and traceparent", async () => {
        const mockQueue = createMockQueue();
        const scheduled = new Date("2026-10-15T08:00:00Z");

        const builder = new JobBuilder("job-2", { task: "sync", priorityScore: 5 }, mockQueue)
            .priority(5)
            .delay(3000)
            .waitUntil(scheduled)
            .attempts(4)
            .traceparent("00-traceparent-id");

        await builder.add();

        expect(mockQueue.add).toHaveBeenCalledWith(
            "job-2",
            { task: "sync", priorityScore: 5 },
            {
                priority: 5,
                delay: 3000,
                waitUntil: scheduled,
                attempts: 4,
                traceparent: "00-traceparent-id",
            },
        );
    });

    it("should configure backoff overloads with string, string without delay, and object", async () => {
        const mockQueue = createMockQueue();

        // 1. backoff with type and delay
        await new JobBuilder("b-1", { task: "retry", priorityScore: 1 }, mockQueue)
            .backoff("fixed", 500)
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "b-1",
            expect.anything(),
            expect.objectContaining({
                backoff: { type: "fixed", delay: 500 },
            }),
        );

        // 2. backoff with type and omitted delay (defaults to 0)
        await (
            new JobBuilder("b-2", { task: "retry", priorityScore: 1 }, mockQueue) as unknown as {
                backoff: (type: string) => JobBuilder<TestPayload>;
                add: () => Promise<Job<TestPayload>>;
            }
        )
            .backoff("exponential")
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "b-2",
            expect.anything(),
            expect.objectContaining({
                backoff: { type: "exponential", delay: 0 },
            }),
        );

        // 3. backoff with BackoffOptions object
        await new JobBuilder("b-3", { task: "retry", priorityScore: 1 }, mockQueue)
            .backoff({ type: "exponential", delay: 1000 })
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "b-3",
            expect.anything(),
            expect.objectContaining({
                backoff: { type: "exponential", delay: 1000 },
            }),
        );
    });

    it("should configure repeat overloads with number, number + limit, and object", async () => {
        const mockQueue = createMockQueue();

        await new JobBuilder("r-1", { task: "cron", priorityScore: 1 }, mockQueue)
            .repeat(60000)
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "r-1",
            expect.anything(),
            expect.objectContaining({ repeat: { every: 60000 } }),
        );

        await new JobBuilder("r-2", { task: "cron", priorityScore: 1 }, mockQueue)
            .repeat(30000, 5)
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "r-2",
            expect.anything(),
            expect.objectContaining({ repeat: { every: 30000, limit: 5 } }),
        );

        await new JobBuilder("r-3", { task: "cron", priorityScore: 1 }, mockQueue)
            .repeat({ every: 15000, limit: 3 })
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "r-3",
            expect.anything(),
            expect.objectContaining({ repeat: { every: 15000, limit: 3 } }),
        );
    });

    it("should configure deduplication and deduplicate overloads", async () => {
        const mockQueue = createMockQueue();

        await new JobBuilder("d-1", { task: "dedup", priorityScore: 1 }, mockQueue)
            .deduplication({ ttl: 5000, id: "custom-key" })
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "d-1",
            expect.anything(),
            expect.objectContaining({ deduplication: { ttl: 5000, id: "custom-key" } }),
        );

        await new JobBuilder("d-2", { task: "dedup", priorityScore: 1 }, mockQueue)
            .deduplicate()
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "d-2",
            expect.anything(),
            expect.objectContaining({ deduplication: true }),
        );

        await new JobBuilder("d-3", { task: "dedup", priorityScore: 1 }, mockQueue)
            .deduplicate(false)
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "d-3",
            expect.anything(),
            expect.objectContaining({ deduplication: false }),
        );
    });

    it("should configure removal lifecycle flags with default and explicit parameters", async () => {
        const mockQueue = createMockQueue();

        await new JobBuilder("rem-1", { task: "clean", priorityScore: 1 }, mockQueue)
            .removeOnSuccess()
            .removeOnFailure()
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "rem-1",
            expect.anything(),
            expect.objectContaining({ removeOnSuccess: true, removeOnFailure: true }),
        );

        await new JobBuilder("rem-2", { task: "clean", priorityScore: 1 }, mockQueue)
            .removeOnSuccess(false)
            .removeOnFailure(false)
            .add();
        expect(mockQueue.add).toHaveBeenCalledWith(
            "rem-2",
            expect.anything(),
            expect.objectContaining({ removeOnSuccess: false, removeOnFailure: false }),
        );
    });

    it("should merge options using partial object and JobOptionsBuilder", async () => {
        const mockQueue = createMockQueue();

        await new JobBuilder("opt-1", { task: "merge", priorityScore: 1 }, mockQueue)
            .options({ priority: 7, attempts: 2 })
            .options(jobOptions().priority(12))
            .add();

        expect(mockQueue.add).toHaveBeenCalledWith(
            "opt-1",
            expect.anything(),
            expect.objectContaining({ priority: 12, attempts: 2 }),
        );
    });
});
