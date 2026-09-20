import { type Mocked, vi } from "vitest";
import { AddJobUseCase } from "../../src/application/use-cases/add-job.use-case.js";
import { JobAlreadyExistsError } from "../../src/domain/errors/job-already-exists.error.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";
import type { IJobSerializer } from "../../src/domain/serializers/job-serializer.interface.js";

// Score calculation multiplier from AddJobUseCase implementation
const PRIORITY_MULTIPLIER = 10000000000000;

describe("AddJobUseCase", () => {
    let addJobUseCase: AddJobUseCase<{ message: string }>;
    let mockQueueRepository: Mocked<IQueueRepository<{ message: string }>>;

    beforeEach(() => {
        mockQueueRepository = {
            add: vi.fn().mockResolvedValue(undefined as never),
            fetchNext: vi.fn(),
            markAsCompleted: vi.fn(),
            markAsFailed: vi.fn(),
            updateProgress: vi.fn().mockResolvedValue(undefined as never),
            fetchNextJobs: vi.fn(),
            promoteDelayedJobs: vi.fn(),
            recoverStalledJobs: vi.fn(),
            extendLock: vi.fn(),
        } as unknown as Mocked<IQueueRepository<{ message: string }>>;
        addJobUseCase = new AddJobUseCase(mockQueueRepository);
    });

    it("should create a job with default options and add to repository", async () => {
        const id = "job-123";
        const data = { message: "test message" };

        const result = await addJobUseCase.execute(id, data);

        expect(mockQueueRepository.add).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            id,
            data,
            status: "waiting",
            priority: 10,
            retryCount: 0,
            maxAttempts: 1,
        });
        expect(result.addedAt).toBeInstanceOf(Date);
    });

    it("should create a job with custom priority", async () => {
        const id = "job-456";
        const data = { message: "high priority" };
        const options = { priority: 1 };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.priority).toBe(1);
        expect(result.status).toBe("waiting");
    });

    it("should create a delayed job when delay option is provided", async () => {
        const id = "job-789";
        const data = { message: "delayed job" };
        const options = { delay: 5000 };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.status).toBe("delayed");
        expect(mockQueueRepository.add).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Number),
            true,
        );
    });

    it("should create a delayed job when waitUntil option is provided", async () => {
        const id = "job-abc";
        const data = { message: "wait until job" };
        const futureDate = new Date(Date.now() + 10000);
        const options = { waitUntil: futureDate };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.status).toBe("delayed");
        expect(mockQueueRepository.add).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Number),
            true,
        );
    });

    it("should set maxAttempts from options", async () => {
        const id = "job-def";
        const data = { message: "retry job" };
        const options = { attempts: 5 };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.maxAttempts).toBe(5);
    });

    it("should calculate score based on priority and timestamp", async () => {
        const id = "job-ghi";
        const data = { message: "score test" };
        const options = { priority: 2 };

        const beforeCall = Date.now();
        await addJobUseCase.execute(id, data, options);
        const afterCall = Date.now();

        const minExpectedScore = 2 * PRIORITY_MULTIPLIER + beforeCall;
        const maxExpectedScore = 2 * PRIORITY_MULTIPLIER + afterCall;

        expect(mockQueueRepository.add).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(Number),
            false,
        );

        const call0 = mockQueueRepository.add.mock.calls[0];
        const actualScore = call0?.[1] ?? 0;
        expect(actualScore).toBeGreaterThanOrEqual(minExpectedScore);
        expect(actualScore).toBeLessThanOrEqual(maxExpectedScore);
    });

    it("should calculate score with delay included", async () => {
        const id = "job-jkl";
        const data = { message: "delayed score test" };
        const delay = 5000;
        const options = { priority: 1, delay };

        const beforeCall = Date.now();
        await addJobUseCase.execute(id, data, options);
        const afterCall = Date.now();

        const minExpectedScore = 1 * PRIORITY_MULTIPLIER + beforeCall + delay;
        const maxExpectedScore = 1 * PRIORITY_MULTIPLIER + afterCall + delay;

        const call0 = mockQueueRepository.add.mock.calls[0];
        const actualScore = call0?.[1] ?? 0;
        expect(actualScore).toBeGreaterThanOrEqual(minExpectedScore);
        expect(actualScore).toBeLessThanOrEqual(maxExpectedScore);
    });

    it("should ensure higher priority (lower number) has lower score", async () => {
        const data = { message: "priority comparison" };

        await addJobUseCase.execute("job-high", data, { priority: 1 });
        const highPriorityScore = mockQueueRepository.add.mock.calls[0]?.[1];

        await addJobUseCase.execute("job-low", data, { priority: 10 });
        const lowPriorityScore = mockQueueRepository.add.mock.calls[1]?.[1];

        expect(typeof highPriorityScore).toBe("number");
        expect(typeof lowPriorityScore).toBe("number");
        expect(highPriorityScore ?? 0).toBeLessThan(lowPriorityScore ?? 0);
    });

    it("should ensure FIFO ordering within same priority", async () => {
        const data = { message: "fifo test" };
        const priority = 5;

        vi.useFakeTimers();
        const baseTime = Date.now();
        vi.setSystemTime(baseTime);

        await addJobUseCase.execute("job-first", data, { priority });
        const firstScore = mockQueueRepository.add.mock.calls[0]?.[1];

        vi.setSystemTime(baseTime + 10);

        await addJobUseCase.execute("job-second", data, { priority });
        const secondScore = mockQueueRepository.add.mock.calls[1]?.[1];

        expect(typeof firstScore).toBe("number");
        expect(typeof secondScore).toBe("number");
        expect(firstScore ?? 0).toBeLessThan(secondScore ?? 0);

        vi.useRealTimers();
    });

    it("should return the created job", async () => {
        const id = "job-return-test";
        const data = { message: "return test" };

        const result = await addJobUseCase.execute(id, data);

        expect(result.id).toBe(id);
        expect(result.data).toEqual(data);
        expect(result).toHaveProperty("addedAt");
        expect(result).toHaveProperty("status");
        expect(result).toHaveProperty("priority");
    });

    it("should include updateProgress function in created job", async () => {
        const id = "job-update-progress-test";
        const data = { message: "update progress test" };

        const result = await addJobUseCase.execute(id, data);

        expect(result.updateProgress).toBeDefined();
        expect(typeof result.updateProgress).toBe("function");
        await expect(result.updateProgress?.(100)).resolves.toBeUndefined();
    });

    it("should include backoff strategy when provided", async () => {
        const id = "job-backoff-test";
        const data = { message: "backoff test" };
        const backoff = { type: "exponential" as const, delay: 1000 };
        const options = { backoff };

        const result = await addJobUseCase.execute(id, data, options);

        expect(result.backoff).toEqual(backoff);
    });

    it("should propagate traceparent when provided in options", async () => {
        const id = "job-trace-test";
        const data = { message: "trace test" };
        const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

        const result = await addJobUseCase.execute(id, data, { traceparent });

        expect(result.traceparent).toBe(traceparent);
    });

    it("should include repeat option with count initialized to 0 when provided", async () => {
        const id = "job-repeat-test";
        const data = { message: "repeat test" };
        const repeat = { every: 5000, limit: 10 };

        const result = await addJobUseCase.execute(id, data, { repeat });

        expect(result.repeat).toEqual({ every: 5000, limit: 10, count: 0 });
    });

    describe("Deduplication & Idempotency", () => {
        it("should pass explicit deduplication id and ttl to repository", async () => {
            const id = "job-dedup-1";
            const data = { message: "dedup test" };
            const options = {
                deduplication: {
                    id: "custom-dedup-key",
                    ttl: 30000,
                },
            };

            await addJobUseCase.execute(id, data, options);

            expect(mockQueueRepository.add).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(Number),
                false,
                { id: "custom-dedup-key", ttl: 30000 },
            );
        });

        it("should compute SHA-256 content hash when deduplication is true without explicit id", async () => {
            const id = "job-dedup-2";
            const data = { message: "auto hash" };

            await addJobUseCase.execute(id, data, { deduplication: true });

            expect(mockQueueRepository.add).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(Number),
                false,
                { id: expect.any(String), ttl: 60000 },
            );
        });

        it("should use serializer when available to compute content hash", async () => {
            const mockSerializer: IJobSerializer = {
                serialize: vi.fn().mockReturnValue(Buffer.from("custom-serialized-bytes")),
                deserialize: vi.fn(),
            };
            const useCaseWithSerializer = new AddJobUseCase(mockQueueRepository, mockSerializer);

            await useCaseWithSerializer.execute(
                "job-ser",
                { message: "serialized" },
                { deduplication: true },
            );

            expect(mockSerializer.serialize).toHaveBeenCalledWith({ message: "serialized" });
            expect(mockQueueRepository.add).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(Number),
                false,
                expect.objectContaining({ id: expect.any(String), ttl: 60000 }),
            );
        });

        it("should use string directly when data is string and no serializer", async () => {
            const stringUseCase = new AddJobUseCase<string>(
                mockQueueRepository as unknown as IQueueRepository<string>,
            );

            await stringUseCase.execute("str-job", "raw-string-data", { deduplication: true });

            expect(mockQueueRepository.add).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(Number),
                false,
                expect.objectContaining({ id: expect.any(String), ttl: 60000 }),
            );
        });

        it("should mark job as duplicate and update id when strategy is ignore-if-exists", async () => {
            vi.mocked(mockQueueRepository.add).mockResolvedValue({
                isDuplicate: true,
                jobId: "existing-job-99",
            });

            const result = await addJobUseCase.execute(
                "new-job",
                { message: "test" },
                { deduplication: { id: "dedup-key-1", strategy: "ignore-if-exists" } },
            );

            expect(result.isDuplicate).toBe(true);
            expect(result.id).toBe("existing-job-99");

            // Verify updateProgress uses the existing job's id
            await result.updateProgress?.(50);
            expect(mockQueueRepository.updateProgress).toHaveBeenCalledWith("existing-job-99", 50);
        });

        it("should throw JobAlreadyExistsError when duplicate detected and strategy is throw", async () => {
            vi.mocked(mockQueueRepository.add).mockResolvedValue({
                isDuplicate: true,
                jobId: "original-job-42",
            });

            await expect(
                addJobUseCase.execute(
                    "attempted-job",
                    { message: "test" },
                    { deduplication: { id: "unique-order-key", strategy: "throw" } },
                ),
            ).rejects.toThrow(JobAlreadyExistsError);
        });

        it("should not trigger deduplication when deduplication is false", async () => {
            await addJobUseCase.execute(
                "job-no-dedup",
                { message: "plain" },
                { deduplication: false },
            );

            expect(mockQueueRepository.add).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(Number),
                false,
            );
        });
    });
});
