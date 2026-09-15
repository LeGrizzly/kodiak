import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Redis } from "ioredis";

jest.unstable_mockModule("fs", () => ({
    readFileSync: jest.fn().mockReturnValue("return 1"),
    default: { readFileSync: jest.fn().mockReturnValue("return 1") },
}));

const { DragonflyQueueRepository } = await import(
    "../../src/infrastructure/dragonfly/dragonfly-queue.repository.js"
);

describe("DragonflyQueueRepository extra coverage", () => {
    let mockRedis: Partial<Redis> & { pipeline: jest.Mock };
    let mockPipeline: {
        hset: jest.Mock;
        hgetall: jest.Mock;
        hdel: jest.Mock;
        exec: jest.Mock;
    };
    let repo: InstanceType<typeof DragonflyQueueRepository>;

    beforeEach(() => {
        mockPipeline = {
            hset: jest.fn().mockReturnThis(),
            hgetall: jest.fn().mockReturnThis(),
            hdel: jest.fn().mockReturnThis(),
            exec: jest.fn(),
        };

        mockRedis = {
            eval: jest.fn(),
            pipeline: jest.fn().mockReturnValue(mockPipeline),
        } as unknown as Partial<Redis> & { pipeline: jest.Mock };

        repo = new DragonflyQueueRepository("q", mockRedis as unknown as Redis, "pref");
        jest.clearAllMocks();
    });

    it("fetchNextJobs should call hset without lock_owner when ownerToken not provided", async () => {
        const jobIds = ["job-1"];
        const jobData = {
            data: JSON.stringify({ foo: "bar" }),
            priority: "1",
            retry_count: "0",
            max_attempts: "1",
            added_at: String(Date.now()),
            state: "active",
        };

        (mockRedis.eval as jest.Mock).mockResolvedValue(jobIds as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValue([
            [null, "OK"],
            [null, jobData],
        ] as never);

        const jobs = await repo.fetchNextJobs(1, 1000);

        expect(jobs).toHaveLength(1);
        // hset should have been called without lock_owner arg (i.e., 4 args after key)
        expect(mockPipeline.hset).toHaveBeenCalled();
        const hsetArgs = (mockPipeline.hset as jest.Mock).mock.calls[0] as unknown[];
        // args: jobKey, 'state', 'active', 'started_at', now
        expect(hsetArgs.length).toBeGreaterThanOrEqual(5);
        expect(hsetArgs).not.toContain("lock_owner");
    });

    it("extendLock returns true/false and forwards ownerToken correctly", async () => {
        (mockRedis.eval as jest.Mock)
            .mockResolvedValueOnce(1 as never)
            .mockResolvedValueOnce(0 as never);

        const res1 = await repo.extendLock("job-1", Date.now() + 1000, "owner-1");
        expect(res1).toBe(true);
        const call1 = (mockRedis.eval as jest.Mock).mock.calls[0] as unknown[];
        // last argument should be owner token
        expect(call1?.[6]).toBe("owner-1");

        const res2 = await repo.extendLock("job-2", Date.now() + 1000);
        expect(res2).toBe(false);
        const call2 = (mockRedis.eval as jest.Mock).mock.calls[1] as unknown[];
        // when ownerToken omitted, last arg should be empty string
        expect(call2?.[6]).toBe("");
    });

    it("releaseJobs invokes release_jobs script with keys and jobIds", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValue(2 as never);

        await repo.releaseJobs(["j1", "j2"]);

        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            3,
            expect.stringContaining(":active"),
            expect.stringContaining(":waiting"),
            expect.stringContaining(":notify"),
            expect.any(String),
            "j1",
            "j2",
        );
    });

    it("auto-pipelining flushes multiple adds into a single pipeline", async () => {
        const pipelinedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 2, maxWaitMs: 0 },
        );

        const job1 = {
            id: "p1",
            data: { msg: "1" },
            priority: 10,
            status: "waiting" as const,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        };
        const job2 = {
            id: "p2",
            data: { msg: "2" },
            priority: 10,
            status: "waiting" as const,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        };

        const mockPipelineObj = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([
                [null, 1],
                [null, 1],
            ] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockPipelineObj);

        const p1 = pipelinedRepo.add(job1, 100, false);
        const p2 = pipelinedRepo.add(job2, 200, false);

        await Promise.all([p1, p2]);

        expect(mockRedis.pipeline).toHaveBeenCalled();
        expect(mockPipelineObj.exec).toHaveBeenCalled();
    });

    it("auto-pipelining add handles pipeline exec rejection, null results, and item errors", async () => {
        const pipelinedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 2, maxWaitMs: 0 },
        );

        const dummyJob = {
            id: "j1",
            data: { msg: "test" },
            priority: 1,
            status: "waiting" as const,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        };

        // 1. exec() rejects
        const mockFailPipeline = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockRejectedValue(new Error("Pipeline failed") as never),
        };
        mockRedis.pipeline.mockReturnValue(mockFailPipeline);

        await expect(pipelinedRepo.add(dummyJob, 10, false)).rejects.toThrow("Pipeline failed");

        // 2. exec() returns null
        const mockNullPipeline = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue(null as never),
        };
        mockRedis.pipeline.mockReturnValue(mockNullPipeline);

        await expect(pipelinedRepo.add(dummyJob, 10, false)).rejects.toThrow(
            "Pipeline execution returned null",
        );

        // 3. exec() returns item-level error
        const mockItemErrPipeline = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([[new Error("Item error"), null]] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockItemErrPipeline);

        await expect(pipelinedRepo.add(dummyJob, 10, false)).rejects.toThrow("Item error");
    });

    it("pipelined markAsCompleted handles immediate flush, delayed timer, and rejection", async () => {
        const mockPipelineObj = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([[null, 1]] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockPipelineObj);

        // Pipelined repo with maxBatch = 1 (triggers immediate flush)
        const pipelinedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 1, maxWaitMs: 0 },
        );

        await pipelinedRepo.markAsCompleted("c1", new Date());
        expect(mockRedis.pipeline).toHaveBeenCalled();

        // Pipelined repo with timer (maxWaitMs > 0)
        const timedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 10, maxWaitMs: 1 },
        );

        await timedRepo.markAsCompleted("c2", new Date());

        // Test pipeline rejection during flushPipelinedCompletes
        const failingPipelinedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 1, maxWaitMs: 0 },
        );
        mockRedis.pipeline.mockReturnValue({
            evalsha: jest.fn(),
            exec: jest.fn().mockRejectedValue(new Error("Flush failed") as never),
        });

        await expect(failingPipelinedRepo.markAsCompleted("c3", new Date())).rejects.toThrow(
            "Flush failed",
        );
    });

    it("appendScriptToPipeline falls back to pipeline.eval when evalsha is not a function", async () => {
        const pipelinedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 1, maxWaitMs: 0 },
        );

        const mockPipelineNoSha = {
            eval: jest.fn(),
            exec: jest.fn().mockResolvedValue([[null, 1]] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockPipelineNoSha);

        await pipelinedRepo.markAsCompleted("c-nosha", new Date());
        expect(mockPipelineNoSha.eval).toHaveBeenCalled();
    });

    it("fetchNextJobs handles direct array results and ownerToken in string[] branch", async () => {
        // 1. Direct array results [[jobId, [k, v, ...]]]
        const rawArrayResult = [
            ["job-arr-1", ["data", JSON.stringify({ item: "data1" }), "priority", "5"]],
        ];
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce(rawArrayResult as never);

        const jobs1 = await repo.fetchNextJobs(1, 1000);
        expect(jobs1).toHaveLength(1);
        expect(jobs1[0]?.id).toBe("job-arr-1");

        // 2. string[] result with ownerToken
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce(["job-str-1"] as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValueOnce([
            [null, "OK"],
            [null, { data: JSON.stringify({ item: "data2" }), state: "active" }],
        ] as never);

        const jobs2 = await repo.fetchNextJobs(1, 1000, "token-xyz");
        expect(jobs2).toHaveLength(1);
        expect(mockPipeline.hset).toHaveBeenCalledWith(
            expect.any(String),
            "state",
            "active",
            "started_at",
            expect.any(String),
            "lock_owner",
            "token-xyz",
        );
    });

    it("markManyAsCompleted throws when exec returns null or errors", async () => {
        // null exec
        mockRedis.pipeline.mockReturnValue({
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue(null as never),
        });

        await expect(
            repo.markManyAsCompleted([{ jobId: "j1", completedAt: new Date() }]),
        ).rejects.toThrow("Pipeline execution returned null");

        // item error in exec
        mockRedis.pipeline.mockReturnValue({
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([[new Error("Item error")]] as never),
        });

        await expect(
            repo.markManyAsCompleted([{ jobId: "j1", completedAt: new Date() }]),
        ).rejects.toThrow("Item error");

        // empty array returns immediately
        await expect(repo.markManyAsCompleted([])).resolves.toBeUndefined();
    });

    it("promoteDelayedJobs handles string[] results, empty results, and null", async () => {
        // Returns array of string IDs
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce(["j1", "j2"] as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValueOnce([
            [null, 1],
            [null, 1],
        ] as never);

        const promoted = await repo.promoteDelayedJobs(10);
        expect(promoted).toBe(2);
        expect(mockPipeline.hset).toHaveBeenCalledWith(expect.any(String), "state", "waiting");

        // Returns empty array
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce([] as never);
        expect(await repo.promoteDelayedJobs(10)).toBe(0);

        // Returns null
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce(null as never);
        expect(await repo.promoteDelayedJobs(10)).toBe(0);
    });

    it("buildJobFromRecord constructs job with prev_error and ignores corrupted data", async () => {
        // Fetch result with prev_error
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce([
            [
                "j-prev",
                [
                    "data",
                    JSON.stringify({ a: 1 }),
                    "prev_error",
                    "timeout",
                    "prev_failed_at",
                    "1000",
                ],
            ],
        ] as never);

        const jobs = await repo.fetchNextJobs(1, 1000);
        expect(jobs).toHaveLength(1);
        expect(jobs[0]?.errorHistory).toBeDefined();
        expect(jobs[0]?.errorHistory?.[0]?.error).toBe("timeout");

        // Raw with missing data returns null
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce([
            ["j-empty", ["state", "active"]],
        ] as never);
        const emptyJobs = await repo.fetchNextJobs(1, 1000);
        expect(emptyJobs).toHaveLength(0);

        // Raw with empty array returns null
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce([["j-empty2", []]] as never);
        const emptyJobs2 = await repo.fetchNextJobs(1, 1000);
        expect(emptyJobs2).toHaveLength(0);
    });

    it("pipelined add schedules timer when maxWaitMs > 0 and traceparent is added", async () => {
        const mockPipelineObj = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([[null, 1]] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockPipelineObj);

        const timedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 10, maxWaitMs: 1 },
        );

        const jobWithTrace = {
            id: "j-trace",
            data: { msg: "trace" },
            priority: 1,
            status: "waiting" as const,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
            traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        };

        await timedRepo.add(jobWithTrace, 100, false);
        expect(mockRedis.pipeline).toHaveBeenCalled();
    });

    it("pipelined markAsCompleted uses queueMicrotask when maxWaitMs is 0", async () => {
        const mockPipelineObj = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([[null, 1]] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockPipelineObj);

        const microtaskRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 10, maxWaitMs: 0 },
        );

        await microtaskRepo.markAsCompleted("j-micro", new Date());
        expect(mockRedis.pipeline).toHaveBeenCalled();
    });

    it("fetchNext handles unexpected raw result type returning null", async () => {
        // eval returns a number instead of string or array
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce(12345 as never);

        const job = await repo.fetchNext(1000);
        expect(job).toBeNull();
    });

    it("promoteDelayedJobs returns 0 when raw result is an unexpected object", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce({ unexpected: "type" } as never);

        const result = await repo.promoteDelayedJobs(10);
        expect(result).toBe(0);
    });

    it("should instantiate with default prefix and default serializer", () => {
        const defaultRepo = new DragonflyQueueRepository(
            "default-q",
            mockRedis as unknown as Redis,
        );
        const internalRepo = defaultRepo as unknown as {
            keyTopology: { prefix: string };
            serializer: unknown;
        };
        expect(internalRepo.keyTopology.prefix).toBe("kodiak");
        expect(internalRepo.serializer).toBeDefined();
    });

    it("should handle empty batches in flushPipelinedAdds and flushPipelinedCompletes", async () => {
        const pipelinedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxWaitMs: 0 },
        );

        // Directly call private flush when pending lists are empty
        const anyRepo = pipelinedRepo as unknown as {
            flushPipelinedAdds: () => void;
            flushPipelinedCompletes: () => void;
        };
        expect(() => anyRepo.flushPipelinedAdds()).not.toThrow();
        expect(() => anyRepo.flushPipelinedCompletes()).not.toThrow();
    });

    it("should handle raw serializer output as string, Buffer, and Uint8Array", async () => {
        const mockPipelineObj = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([[null, 1]] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockPipelineObj);

        // 1. String serializer
        const strSerializer = {
            serialize: () => '{"custom":"str"}',
            deserialize: <T>(d: unknown) => d as T,
        };
        const strRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "p",
            strSerializer,
        );
        await strRepo.add(
            {
                id: "j-str",
                data: {},
                priority: 1,
                status: "waiting",
                retryCount: 0,
                maxAttempts: 1,
                addedAt: new Date(),
            },
            10,
            false,
        );

        // 2. Buffer serializer
        const bufSerializer = {
            serialize: () => Buffer.from("buffer-content"),
            deserialize: <T>(d: unknown) => d as T,
        };
        const bufRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "p",
            bufSerializer,
        );
        await bufRepo.add(
            {
                id: "j-buf",
                data: {},
                priority: 1,
                status: "waiting",
                retryCount: 0,
                maxAttempts: 1,
                addedAt: new Date(),
            },
            10,
            false,
        );
    });

    it("should forward ownerToken in non-pipelined markAsCompleted", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce(1 as never);

        await repo.markAsCompleted("j-comp", new Date(), "owner-123");
        expect(mockRedis.eval).toHaveBeenCalledWith(
            expect.any(String),
            3,
            expect.any(String),
            expect.any(String),
            expect.any(String),
            "j-comp",
            expect.any(String),
            "owner-123",
        );
    });

    it("should return immediately when releaseJobs is called with empty array", async () => {
        await repo.releaseJobs([]);
        expect(mockRedis.eval).not.toHaveBeenCalled();
    });

    it("should build job record with started_at and fallback for prev_failed_at", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce([
            [
                "j-started",
                [
                    "data",
                    JSON.stringify({ ok: true }),
                    "started_at",
                    "5000",
                    "prev_error",
                    "failed-once",
                ],
            ],
        ] as never);

        const jobs = await repo.fetchNextJobs(1, 1000);
        expect(jobs).toHaveLength(1);
        expect(jobs[0]?.startedAt).toEqual(new Date(5000));
        expect(jobs[0]?.errorHistory?.[0]?.error).toBe("failed-once");
    });

    it("processFetchResult handles null pipeline results, error, and missing data", async () => {
        // String result from move_to_active triggers pipeline hgetall
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce("j-null1" as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValueOnce(null as never);
        expect(await repo.fetchNext(1000)).toBeNull();

        (mockRedis.eval as jest.Mock).mockResolvedValueOnce("j-null2" as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValueOnce([[null, "OK"], null] as never);
        expect(await repo.fetchNext(1000)).toBeNull();

        (mockRedis.eval as jest.Mock).mockResolvedValueOnce("j-null3" as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValueOnce([
            [null, "OK"],
            [new Error("HGETALL failed"), null],
        ] as never);
        expect(await repo.fetchNext(1000)).toBeNull();

        (mockRedis.eval as jest.Mock).mockResolvedValueOnce("j-null4" as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValueOnce([
            [null, "OK"],
            [null, { otherField: "1" }], // missing 'data'
        ] as never);
        expect(await repo.fetchNext(1000)).toBeNull();
    });

    it("pipelined add and complete handle already scheduled flushes and default maxBatch", async () => {
        const mockPipelineObj = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([
                [null, 1],
                [null, 1],
            ] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockPipelineObj);

        const repoWithDefaultMaxBatch = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxWaitMs: 50 },
        );

        const dummy = {
            id: "d1",
            data: {},
            priority: 1,
            status: "waiting" as const,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        };

        // Push two adds: first schedules flush, second hits !pipelineFlushScheduled === false
        const p1 = repoWithDefaultMaxBatch.add(dummy, 1, false);
        const p2 = repoWithDefaultMaxBatch.add(dummy, 1, false);

        // Push two completes: first schedules flush, second hits !completePipelineFlushScheduled === false
        const c1 = repoWithDefaultMaxBatch.markAsCompleted("c1", new Date());
        const c2 = repoWithDefaultMaxBatch.markAsCompleted("c2", new Date());

        // Trigger manual flushes to resolve
        const priv = repoWithDefaultMaxBatch as unknown as {
            flushPipelinedAdds: () => void;
            flushPipelinedCompletes: () => void;
        };
        priv.flushPipelinedAdds();
        priv.flushPipelinedCompletes();

        await Promise.all([p1, p2, c1, c2]);
    });

    it("resolvePipelineBatch handles gaps in batch array", () => {
        const priv = repo as unknown as {
            resolvePipelineBatch: (batch: unknown[], results: unknown[]) => void;
        };

        const batch = [undefined];
        const results = [[null, 1]];

        expect(() => priv.resolvePipelineBatch(batch, results)).not.toThrow();
    });

    it("fetchNextJobs string[] pipeline handles missing result entries", async () => {
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce(["job-1"] as never);
        (mockPipeline.exec as jest.Mock).mockResolvedValueOnce([
            [null, "OK"],
            null, // missing result at results[1]
        ] as never);

        const jobs = await repo.fetchNextJobs(1, 1000);
        expect(jobs).toHaveLength(0);
    });

    it("should accept IConnection wrapping getRawClient and pipelined delayed job", async () => {
        const mockIConn = {
            getRawClient: () => mockRedis as unknown as Redis,
        };

        const mockPipelineObj = {
            eval: jest.fn(),
            evalsha: jest.fn(),
            exec: jest.fn().mockResolvedValue([[null, 1]] as never),
        };
        mockRedis.pipeline.mockReturnValue(mockPipelineObj);

        // Repo with IConnection and pipelining without maxWaitMs (defaults to 0, triggering lines 78 & 136 ?? 0)
        const iConnRepo = new DragonflyQueueRepository(
            "q",
            mockIConn as unknown as Redis,
            "pref",
            {
                serialize: () => new Uint8Array([1, 2, 3]), // Pure Uint8Array, not Buffer
                deserialize: <T>(d: unknown) => d as T,
            },
            { maxBatch: 10 },
        );

        // Add delayed job (covers item.isDelayed true in pipelining and schedulePipelineFlush ?? 0)
        const delayedJob = {
            id: "j-del",
            data: { delay: true },
            priority: 1,
            status: "delayed" as const,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        };

        const addPromise = iConnRepo.add(delayedJob, 1000, true);
        const completePromise = iConnRepo.markAsCompleted("j-del", new Date());

        await Promise.all([addPromise, completePromise]);
        expect(mockRedis.pipeline).toHaveBeenCalled();
    });

    it("should handle odd-length raw arrays, failedAt, progress, and updateProgress", async () => {
        // 1. rawData with odd length in processFetchResult (move_to_active direct array)
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce([
            "j-odd",
            [
                "data",
                JSON.stringify({ odd: true }),
                "failed_at",
                "6000",
                "progress",
                "50",
                "trailing_key", // odd length at end: trailing_key has no value
            ],
        ] as never);

        const job1 = await repo.fetchNext(1000);
        expect(job1).not.toBeNull();
        expect(job1?.failedAt).toEqual(new Date(6000));
        expect(job1?.progress).toBe(50);

        // Test updateProgress attached to job
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce(1 as never);
        await job1?.updateProgress?.(75);

        // 2. raw with odd length in buildJobFromRaw (fetchNextJobs) and without failed_at
        (mockRedis.eval as jest.Mock).mockResolvedValueOnce([
            ["j-odd2", ["data", JSON.stringify({ odd2: true }), "trailing_key2"]],
        ] as never);

        const jobs2 = await repo.fetchNextJobs(1, 1000);
        expect(jobs2).toHaveLength(1);
        expect(jobs2[0]?.failedAt).toBeUndefined();
    });

    it("should handle timers without unref method in pipeline schedulers", async () => {
        const timerSpy = jest
            .spyOn(global, "setTimeout")
            .mockReturnValue(12345 as unknown as NodeJS.Timeout);

        const timedRepo = new DragonflyQueueRepository(
            "q",
            mockRedis as unknown as Redis,
            "pref",
            undefined,
            { maxBatch: 10, maxWaitMs: 10 },
        );

        const dummy = {
            id: "d1",
            data: {},
            priority: 1,
            status: "waiting" as const,
            retryCount: 0,
            maxAttempts: 1,
            addedAt: new Date(),
        };

        void timedRepo.add(dummy, 1, false);
        void timedRepo.markAsCompleted("c1", new Date());

        timerSpy.mockRestore();
    });
});
