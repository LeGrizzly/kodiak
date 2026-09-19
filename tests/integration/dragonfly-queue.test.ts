import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../../src/domain/entities/job.entity.js";
import { DragonflyQueueRepository } from "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js";

interface TestPayload {
    foo: string;
}

describe("Integration: DragonflyQueueRepository", () => {
    let redis: Redis;
    let repository: DragonflyQueueRepository<TestPayload>;
    const queueName = "integration-test-queue";
    const prefix = `kodiak-test-${Math.random().toString(36).slice(2, 8)}`;
    const hashtag = `{${prefix}:${queueName}}`;

    beforeAll(() => {
        redis = new Redis({ host: "localhost", port: 6379, maxRetriesPerRequest: 1 });
    });

    afterAll(async () => {
        const keys = await redis.keys(`${hashtag}*`);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
        await redis.quit();
    });

    beforeEach(async () => {
        const keys = await redis.keys(`${hashtag}*`);
        if (keys.length > 0) await redis.del(...keys);
        repository = new DragonflyQueueRepository<TestPayload>(queueName, redis, prefix);
    });

    const createJob = (
        id: string,
        priority = 10,
        delay = 0,
    ): { job: Job<TestPayload>; score: number } => {
        const job: Job<TestPayload> = {
            id,
            data: { foo: "bar" },
            status: delay > 0 ? "delayed" : "waiting",
            priority,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 1,
            updateProgress: async () => Promise.resolve(),
        };
        const score = priority * 10000000000000 + (Date.now() + delay);
        return { job, score };
    };

    it("should add a job and fetch it back", async () => {
        const { job, score } = createJob("job-1");
        await repository.add(job, score, false);

        const fetchedJob = await repository.fetchNext();

        expect(fetchedJob).not.toBeNull();
        expect(fetchedJob?.id).toBe("job-1");
        expect(fetchedJob?.status).toBe("active");
        expect(fetchedJob?.data).toEqual({ foo: "bar" });
    });

    it("should fetch high priority jobs first", async () => {
        const jobLow = createJob("low", 100);
        const jobHigh = createJob("high", 1);
        const jobNormal = createJob("normal", 10);

        await repository.add(jobLow.job, jobLow.score, false);
        await repository.add(jobNormal.job, jobNormal.score, false);
        await repository.add(jobHigh.job, jobHigh.score, false);

        const first = await repository.fetchNext();
        const second = await repository.fetchNext();
        const third = await repository.fetchNext();

        expect(first?.id).toBe("high");
        expect(second?.id).toBe("normal");
        expect(third?.id).toBe("low");
    });

    it("should not fetch delayed jobs immediately", async () => {
        const { job, score } = createJob("delayed-1", 10, 5000);
        await repository.add(job, score, true);

        const fetched = await repository.fetchNext();
        expect(fetched).toBeNull();

        const delayedScore = await redis.zscore(`${hashtag}:delayed`, "delayed-1");
        expect(delayedScore).not.toBeNull();
    });

    it("should return null when queue is empty", async () => {
        const fetched = await repository.fetchNext();
        expect(fetched).toBeNull();
    });

    it("should mark a job as completed", async () => {
        const { job, score } = createJob("job-completed");
        await repository.add(job, score, false);

        const fetched = await repository.fetchNext();
        expect(fetched?.id).toBe("job-completed");

        const activeCount = await redis.zcard(`${hashtag}:active`);
        expect(activeCount).toBe(1);

        const completedAt = new Date();
        await repository.markAsCompleted("job-completed", completedAt);

        const activeCountAfter = await redis.zcard(`${hashtag}:active`);
        expect(activeCountAfter).toBe(0);

        const state = await redis.hget(`${hashtag}:jobs:job-completed`, "state");
        expect(state).toBe("completed");
    });

    it("should mark a job as failed", async () => {
        const { job, score } = createJob("job-failed");
        await repository.add(job, score, false);

        await repository.fetchNext();

        const failedAt = new Date();
        const errorMsg = "Something went wrong";
        await repository.markAsFailed("job-failed", errorMsg, failedAt);

        const activeCount = await redis.zcard(`${hashtag}:active`);
        expect(activeCount).toBe(0);

        const state = await redis.hget(`${hashtag}:jobs:job-failed`, "state");
        const error = await redis.hget(`${hashtag}:jobs:job-failed`, "error");
        expect(state).toBe("failed");
        expect(error).toBe(errorMsg);
    });

    it("should retry a job if maxAttempts > 1", async () => {
        const { job, score } = createJob("job-retry", 10, 0);
        job.maxAttempts = 2;
        await repository.add(job, score, false);

        await repository.fetchNext();

        const failedAt = new Date();
        const errorMsg = "First failure";
        await repository.markAsFailed("job-retry", errorMsg, failedAt);

        const state = await redis.hget(`${hashtag}:jobs:job-retry`, "state");
        expect(state).toBe("delayed");

        const retryCount = await redis.hget(`${hashtag}:jobs:job-retry`, "retry_count");
        expect(retryCount).toBe("1");

        const activeCount = await redis.zcard(`${hashtag}:active`);
        expect(activeCount).toBe(0);

        const delayedScore = await redis.zscore(`${hashtag}:delayed`, "job-retry");
        expect(delayedScore).not.toBeNull();
    });

    it("should reschedule a recurring job upon completion", async () => {
        const { job, score } = createJob("job-recurring", 10, 0);
        job.repeat = { every: 1000, count: 0, limit: 3 };

        await repository.add(job, score, false);

        await repository.fetchNext();
        await repository.markAsCompleted("job-recurring", new Date());

        let state = await redis.hget(`${hashtag}:jobs:job-recurring`, "state");
        expect(state).toBe("delayed");
        const repeatCount = await redis.hget(`${hashtag}:jobs:job-recurring`, "repeat_count");
        expect(repeatCount).toBe("1");

        const delayedScore = await redis.zscore(`${hashtag}:delayed`, "job-recurring");
        expect(delayedScore).not.toBeNull();

        await redis.hset(`${hashtag}:jobs:job-recurring`, "repeat_count", "2");

        await redis.zrem(`${hashtag}:delayed`, "job-recurring");
        await redis.zadd(`${hashtag}:active`, Date.now(), "job-recurring");

        await repository.markAsCompleted("job-recurring", new Date());

        state = await redis.hget(`${hashtag}:jobs:job-recurring`, "state");
        expect(state).toBe("completed");
    });

    it("should return null if job data is missing (corrupted state)", async () => {
        const jobId = "ghost-job";
        await redis.zadd(`${hashtag}:waiting`, 1000, jobId);

        const fetched = await repository.fetchNext();
        expect(fetched).toBeNull();
    });

    it("should release active jobs back to waiting queue immediately", async () => {
        const j1 = createJob("rel-1");
        const j2 = createJob("rel-2");
        await repository.add(j1.job, j1.score, false);
        await repository.add(j2.job, j2.score, false);

        await repository.fetchNext();
        await repository.fetchNext();

        let activeCount = await redis.zcard(`${hashtag}:active`);
        let waitingCount = await redis.zcard(`${hashtag}:waiting`);
        expect(activeCount).toBe(2);
        expect(waitingCount).toBe(0);

        await repository.releaseJobs(["rel-1", "rel-2"]);

        activeCount = await redis.zcard(`${hashtag}:active`);
        waitingCount = await redis.zcard(`${hashtag}:waiting`);
        expect(activeCount).toBe(0);
        expect(waitingCount).toBe(2);

        const state1 = await redis.hget(`${hashtag}:jobs:rel-1`, "state");
        expect(state1).toBe("waiting");
    });

    it("should persist error history and error stack in DLQ when maxAttempts exceeded", async () => {
        const { job, score } = createJob("dlq-job");
        job.maxAttempts = 2;
        await repository.add(job, score, false);

        await repository.fetchNext();
        await repository.markAsFailed("dlq-job", "First attempt error", new Date());

        // Second attempt
        await redis.zrem(`${hashtag}:delayed`, "dlq-job");
        await redis.zadd(`${hashtag}:active`, Date.now(), "dlq-job");

        const secondErrorStack = "Error: Final fatal crash\n    at Object.test (test.ts:10)";
        await repository.markAsFailed(
            "dlq-job",
            "Final fatal crash",
            new Date(),
            undefined,
            undefined,
            secondErrorStack,
        );

        const deadCount = await redis.zcard(`${hashtag}:dead`);
        expect(deadCount).toBe(1);

        const state = await redis.hget(`${hashtag}:jobs:dlq-job`, "state");
        const error = await redis.hget(`${hashtag}:jobs:dlq-job`, "error");
        const prevError = await redis.hget(`${hashtag}:jobs:dlq-job`, "prev_error");
        const errorStack = await redis.hget(`${hashtag}:jobs:dlq-job`, "error_stack");

        expect(state).toBe("failed");
        expect(error).toBe("Final fatal crash");
        expect(prevError).toBe("First attempt error");
        expect(errorStack).toContain("Final fatal crash");
    });

    it("should persist and reconstruct traceparent OpenTelemetry context", async () => {
        const { job, score } = createJob("trace-job");
        const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        job.traceparent = traceparent;

        await repository.add(job, score, false);

        const fetched = await repository.fetchNext();
        expect(fetched?.traceparent).toBe(traceparent);
    });

    it("should successfully insert jobs via auto-pipelining micro-batching", async () => {
        const pipelinedRepo = new DragonflyQueueRepository<TestPayload>(
            queueName,
            redis,
            prefix,
            undefined,
            { maxBatch: 5, maxWaitMs: 2 },
        );

        const addPromises: Promise<unknown>[] = [];
        for (let i = 0; i < 15; i++) {
            const { job, score } = createJob(`pipeline-job-${i}`);
            addPromises.push(pipelinedRepo.add(job, score, false));
        }

        await Promise.all(addPromises);

        const waitingCount = await redis.zcard(`${hashtag}:waiting`);
        expect(waitingCount).toBe(15);
    });
});
