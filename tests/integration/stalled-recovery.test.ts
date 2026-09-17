import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DragonflyQueueRepository } from "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js";

interface Payload {
    foo: string;
}

describe("Integration: stalled jobs recovery", () => {
    let redis: Redis;
    let repository: DragonflyQueueRepository<Payload>;
    const queueName = "stalled-recovery-queue";
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
        repository = new DragonflyQueueRepository<Payload>(queueName, redis, prefix);
    });

    it("should move an expired active job back to waiting and increment retry_count", async () => {
        const jobId = "stalled-job-1";
        const jobKey = `${hashtag}:jobs:${jobId}`;

        await redis.hset(
            jobKey,
            "data",
            JSON.stringify({ foo: "bar" }),
            "priority",
            "10",
            "retry_count",
            "0",
            "max_attempts",
            "3",
            "added_at",
            String(Date.now()),
        );

        const expiredScore = Date.now() - 1000;
        await redis.zadd(`${hashtag}:active`, expiredScore, jobId);

        const activeCheckCount = await redis.zcard(`${hashtag}:active`);
        expect(activeCheckCount).toBe(1);

        const waitingCount = await redis.zcard(`${hashtag}:waiting`);
        expect(waitingCount).toBe(0);

        const recoveredJobs = await repository.recoverStalledJobs();
        expect(recoveredJobs).toEqual([jobId]);

        const activeCount = await redis.zcard(`${hashtag}:active`);
        expect(activeCount).toBe(0);

        const waiting = await redis.zrange(`${hashtag}:waiting`, "0", "-1");
        expect(waiting).toContain(jobId);

        const retry = await redis.hget(jobKey, "retry_count");
        expect(retry).toBe("1");
    });
});
