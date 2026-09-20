import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobAlreadyExistsError } from "../../src/domain/errors/job-already-exists.error.js";
import { Kodiak } from "../../src/presentation/kodiak.js";
import type { Queue } from "../../src/presentation/queue.js";

interface EmailPayload {
    recipient: string;
    body: string;
    amount?: number;
}

describe("Integration: Job Deduplication & Idempotency on DragonflyDB", () => {
    let redis: Redis;
    let kodiak: Kodiak;
    let queue: Queue<EmailPayload>;
    const queueName = "dedup-integration-queue";
    const prefix = `kodiak-dedup-${Math.random().toString(36).slice(2, 8)}`;
    const hashtag = `{${prefix}:${queueName}}`;

    beforeAll(() => {
        redis = new Redis({ host: "localhost", port: 6379, maxRetriesPerRequest: 1 });
        kodiak = new Kodiak({
            connection: { host: "localhost", port: 6379 },
            prefix,
        });
    });

    afterAll(async () => {
        if (queue) await queue.close();
        if (kodiak) await kodiak.close();
        const keys = await redis.keys(`${hashtag}*`);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
        await redis.quit();
    });

    beforeEach(async () => {
        const keys = await redis.keys(`${hashtag}*`);
        if (keys.length > 0) await redis.del(...keys);
        if (queue) await queue.close();
        queue = kodiak.createQueue<EmailPayload>(queueName);
    });

    it("should silently ignore duplicate jobs when strategy is ignore-if-exists", async () => {
        const payload: EmailPayload = { recipient: "alice@test.com", body: "Hello Alice" };
        const dedupOpts = {
            id: "email:alice:1",
            ttl: 10000,
            strategy: "ignore-if-exists" as const,
        };

        const firstJob = await queue.add("job-alice-1", payload, { deduplication: dedupOpts });
        expect(firstJob.isDuplicate).toBeFalsy();
        expect(firstJob.id).toBe("job-alice-1");

        const secondJob = await queue.add("job-alice-2", payload, { deduplication: dedupOpts });
        expect(secondJob.isDuplicate).toBe(true);
        expect(secondJob.id).toBe("job-alice-1"); // Points to original job

        // Verify only 1 job actually in Redis waiting queue
        const waitingCount = await redis.zcard(`${hashtag}:waiting`);
        expect(waitingCount).toBe(1);
    });

    it("should throw JobAlreadyExistsError when strategy is throw", async () => {
        const payload: EmailPayload = { recipient: "bob@test.com", body: "Invoice #999" };
        const dedupOpts = { id: "invoice:999", ttl: 10000, strategy: "throw" as const };

        const firstJob = await queue.add("inv-job-1", payload, { deduplication: dedupOpts });
        expect(firstJob.id).toBe("inv-job-1");

        await expect(queue.add("inv-job-2", payload, { deduplication: dedupOpts })).rejects.toThrow(
            JobAlreadyExistsError,
        );

        const waitingCount = await redis.zcard(`${hashtag}:waiting`);
        expect(waitingCount).toBe(1);
    });

    it("should perform automatic content hashing when deduplication is true", async () => {
        const payloadA: EmailPayload = {
            recipient: "carol@test.com",
            body: "Payment receipt",
            amount: 150,
        };
        const payloadB: EmailPayload = {
            recipient: "carol@test.com",
            body: "Payment receipt",
            amount: 200,
        };

        // First add: succeeds
        const job1 = await queue.add("job-hash-1", payloadA, { deduplication: true });
        expect(job1.isDuplicate).toBeFalsy();

        // Second add with identical payload: duplicate!
        const job2 = await queue.add("job-hash-2", payloadA, { deduplication: true });
        expect(job2.isDuplicate).toBe(true);
        expect(job2.id).toBe("job-hash-1");

        // Third add with different payload: succeeds!
        const job3 = await queue.add("job-hash-3", payloadB, { deduplication: true });
        expect(job3.isDuplicate).toBeFalsy();
        expect(job3.id).toBe("job-hash-3");

        const waitingCount = await redis.zcard(`${hashtag}:waiting`);
        expect(waitingCount).toBe(2);
    });

    it("should allow re-inserting same job after deduplication window (TTL) expires", async () => {
        const payload: EmailPayload = { recipient: "dave@test.com", body: "Quick ping" };
        const dedupOpts = { id: "ping:dave", ttl: 200 };

        const firstJob = await queue.add("ping-1", payload, { deduplication: dedupOpts });
        expect(firstJob.isDuplicate).toBeFalsy();

        // Immediately retry: blocked
        const immediateRetry = await queue.add("ping-2", payload, { deduplication: dedupOpts });
        expect(immediateRetry.isDuplicate).toBe(true);

        // Wait for TTL (200ms) to expire
        await new Promise((resolve) => setTimeout(resolve, 300));

        // After TTL: succeeds as fresh job
        const afterTtlJob = await queue.add("ping-3", payload, { deduplication: dedupOpts });
        expect(afterTtlJob.isDuplicate).toBeFalsy();
        expect(afterTtlJob.id).toBe("ping-3");
    });

    it("should allow manual removal of deduplication key via removeDeduplicationKey", async () => {
        const payload: EmailPayload = { recipient: "eve@test.com", body: "Reset token" };
        const dedupId = "token:eve";

        await queue.add("eve-1", payload, { deduplication: { id: dedupId, ttl: 60000 } });

        const duplicateAttempt = await queue.add("eve-2", payload, {
            deduplication: { id: dedupId, ttl: 60000 },
        });
        expect(duplicateAttempt.isDuplicate).toBe(true);

        // Manually remove deduplication lock
        const removed = await queue.removeDeduplicationKey(dedupId);
        expect(removed).toBe(true);

        // Try again: succeeds!
        const afterRemoval = await queue.add("eve-3", payload, {
            deduplication: { id: dedupId, ttl: 60000 },
        });
        expect(afterRemoval.isDuplicate).toBeFalsy();
        expect(afterRemoval.id).toBe("eve-3");
    });

    it("should support queue-level default deduplication and per-job bypass", async () => {
        const dedupQueue = kodiak.createQueue<EmailPayload>("queue-level-dedup", {
            deduplication: { ttl: 10000 },
        });

        const payload: EmailPayload = { recipient: "frank@test.com", body: "Weekly Digest" };

        const job1 = await dedupQueue.add("frank-1", payload);
        expect(job1.isDuplicate).toBeFalsy();

        // Second add without explicit options inherits queue-level deduplication
        const job2 = await dedupQueue.add("frank-2", payload);
        expect(job2.isDuplicate).toBe(true);

        // Third add with deduplication: false bypasses queue-level deduplication
        const job3 = await dedupQueue.add("frank-3", payload, { deduplication: false });
        expect(job3.isDuplicate).toBeFalsy();
        expect(job3.id).toBe("frank-3");

        await dedupQueue.close();
    });
});
