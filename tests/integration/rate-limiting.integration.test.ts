import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../../src/domain/entities/job.entity.js";
import { DragonflyQueueRepository } from "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js";

interface TestPayload {
    count: number;
}

describe("Integration: Rate Limiting (Token Bucket) on DragonflyDB", () => {
    let redis: Redis;
    const queueName = "rate-limit-integration-queue";
    const prefix = `kodiak-rl-${Math.random().toString(36).slice(2, 8)}`;
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
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    });

    const createJob = (
        id: string,
        count: number,
        priority = 10,
    ): { job: Job<TestPayload>; score: number } => {
        const job: Job<TestPayload> = {
            id,
            data: { count },
            status: "waiting",
            priority,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: 1,
            updateProgress: async () => Promise.resolve(),
        };
        const score = priority * 10000000000000 + Date.now();
        return { job, score };
    };

    it("should allow jobs within rate limit and delay jobs that exceed rate limit", async () => {
        // Configure limiter: max 2 jobs per second, burst 2
        const repository = new DragonflyQueueRepository<TestPayload>(
            queueName,
            redis,
            prefix,
            undefined,
            undefined,
            { max: 2, duration: 1000, burst: 2, onExceeded: "delay", retryDelay: 200 },
        );

        // Add 3 jobs
        const job1 = createJob("job-1", 1);
        const job2 = createJob("job-2", 2);
        const job3 = createJob("job-3", 3);
        await repository.add(job1.job, job1.score, false);
        await repository.add(job2.job, job2.score, false);
        await repository.add(job3.job, job3.score, false);

        // Fetch 1: should succeed (job-1)
        const fetched1 = await repository.fetchNext();
        expect(fetched1).not.toBeNull();
        expect(fetched1?.id).toBe("job-1");

        // Fetch 2: should succeed (job-2)
        const fetched2 = await repository.fetchNext();
        expect(fetched2).not.toBeNull();
        expect(fetched2?.id).toBe("job-2");

        // Fetch 3: limit exceeded! Should return null and move job-3 to delayed ZSet
        const fetched3 = await repository.fetchNext();
        expect(fetched3).toBeNull();

        // Verify that job-3 was moved to delayed ZSet
        const delayedScore = await redis.zscore(`${hashtag}:delayed`, "job-3");
        expect(delayedScore).not.toBeNull();

        // Verify rate limit status
        const status = await repository.getRateLimitStatus();
        expect(status).not.toBeNull();
        expect(status?.max).toBe(2);
        expect(status?.tokens).toBeLessThan(1);
    });

    it("should support batch fetching with rate limiter", async () => {
        // Allow up to 3 jobs per window
        const repository = new DragonflyQueueRepository<TestPayload>(
            queueName,
            redis,
            prefix,
            undefined,
            undefined,
            { max: 3, duration: 1000, burst: 3, onExceeded: "delay" },
        );

        for (let i = 1; i <= 3; i++) {
            const j = createJob(`batch-job-${i}`, i);
            await repository.add(j.job, j.score, false);
        }

        // Fetch batch of 3: should succeed
        const fetched = await repository.fetchNextJobs(3, 30000, "worker:0");
        expect(fetched).toHaveLength(3);

        // Subsequent fetch should be denied
        const denied = await repository.fetchNextJobs(1, 30000, "worker:0");
        expect(denied).toHaveLength(0);
    });
});
