import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";
import type { Kodiak } from "../../src/presentation/kodiak.js";
import { Queue } from "../../src/presentation/queue.js";

describe("Unit: Queue Deduplication", () => {
    let mockKodiak: Kodiak;
    let mockRepository: IQueueRepository<{ foo: string }>;

    beforeEach(() => {
        const mockRedis = {
            duplicate: vi.fn().mockReturnThis(),
            quit: vi.fn().mockResolvedValue("OK"),
        };

        mockKodiak = {
            connection: mockRedis as unknown as Redis,
            prefix: "kodiak-test",
            serializer: {
                serialize: vi.fn().mockReturnValue("serialized"),
                deserialize: vi.fn(),
            },
        } as unknown as Kodiak;

        mockRepository = {
            add: vi.fn().mockResolvedValue({ isDuplicate: false, jobId: "job-1" }),
            fetchNext: vi.fn(),
            fetchNextJobs: vi.fn(),
            markAsCompleted: vi.fn(),
            markAsFailed: vi.fn(),
            updateProgress: vi.fn(),
            promoteDelayedJobs: vi.fn().mockResolvedValue(0),
            recoverStalledJobs: vi.fn().mockResolvedValue([]),
            extendLock: vi.fn(),
            releaseJobs: vi.fn(),
            deleteDeduplicationKey: vi.fn().mockResolvedValue(true),
        } as unknown as IQueueRepository<{ foo: string }>;
    });

    it("should inherit queue-level deduplication when job options do not specify deduplication", async () => {
        const queue = new Queue<{ foo: string }>("test-dedup-queue", mockKodiak, mockRepository, {
            deduplication: { ttl: 50000, strategy: "ignore-if-exists" },
        });

        await queue.add("job-1", { foo: "bar" });

        expect(mockRepository.add).toHaveBeenCalledWith(
            expect.objectContaining({ id: "job-1" }),
            expect.any(Number),
            false,
            expect.objectContaining({ ttl: 50000 }),
        );

        await queue.close();
    });

    it("should allow job-level deduplication to override queue-level default", async () => {
        const queue = new Queue<{ foo: string }>("test-dedup-queue", mockKodiak, mockRepository, {
            deduplication: { ttl: 50000 },
        });

        await queue.add(
            "job-2",
            { foo: "bar" },
            { deduplication: { id: "custom-id-99", ttl: 12000 } },
        );

        expect(mockRepository.add).toHaveBeenCalledWith(
            expect.objectContaining({ id: "job-2" }),
            expect.any(Number),
            false,
            { id: "custom-id-99", ttl: 12000 },
        );

        await queue.close();
    });

    it("should bypass deduplication when job specifies deduplication: false", async () => {
        const queue = new Queue<{ foo: string }>("test-dedup-queue", mockKodiak, mockRepository, {
            deduplication: { ttl: 50000 },
        });

        await queue.add("job-3", { foo: "bar" }, { deduplication: false });

        expect(mockRepository.add).toHaveBeenCalledWith(
            expect.objectContaining({ id: "job-3" }),
            expect.any(Number),
            false,
        );

        await queue.close();
    });

    it("should delegate removeDeduplicationKey to repository", async () => {
        const queue = new Queue<{ foo: string }>("test-dedup-queue", mockKodiak, mockRepository);

        const result = await queue.removeDeduplicationKey("order-to-clear");

        expect(result).toBe(true);
        expect(mockRepository.deleteDeduplicationKey).toHaveBeenCalledWith("order-to-clear");

        await queue.close();
    });

    it("should return false from removeDeduplicationKey if repository has no deleteDeduplicationKey", async () => {
        const repoWithoutDelete: IQueueRepository<{ foo: string }> = {
            ...mockRepository,
            deleteDeduplicationKey: undefined,
        };

        const queue = new Queue<{ foo: string }>("test-dedup-queue", mockKodiak, repoWithoutDelete);

        const result = await queue.removeDeduplicationKey("any-key");
        expect(result).toBe(false);

        await queue.close();
    });
});
