import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
vi.doMock("../../src/application/use-cases/add-job.use-case.js", () => ({
    AddJobUseCase: vi.fn(function MockAddJobUseCase() {
        return {
            execute: mockExecute,
        };
    }),
}));

const mockPromoteDelayedJobs = vi.fn().mockResolvedValue(0 as never);
const mockRecoverStalledJobs = vi.fn().mockResolvedValue([] as never);

vi.doMock("../../src/infrastructure/dragonfly/dragonfly-queue.repository.js", () => ({
    DragonflyQueueRepository: vi.fn(function MockDragonflyQueueRepository() {
        return {
            promoteDelayedJobs: mockPromoteDelayedJobs,
            recoverStalledJobs: mockRecoverStalledJobs,
            add: vi.fn(),
        };
    }),
}));

const { Queue } = await import("../../src/presentation/queue.js");

import { JobBuilder } from "../../src/presentation/job-builder.js";
import type { Kodiak } from "../../src/presentation/kodiak.js";

describe("Unit: Queue", () => {
    let mockKodiak: Kodiak;

    beforeEach(() => {
        vi.useFakeTimers();

        const mockConnection = {
            duplicate: vi.fn(() => mockConnection),
            quit: vi.fn().mockResolvedValue("OK" as never),
        };

        mockKodiak = {
            connection: mockConnection,
            prefix: "test",
        } as unknown as Kodiak;
        mockPromoteDelayedJobs.mockClear();
        mockRecoverStalledJobs.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("should start a scheduler that calls promoteDelayedJobs periodically", async () => {
        const queue = new Queue("test-queue", mockKodiak);

        vi.advanceTimersByTime(5000);

        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(5000);

        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(2);

        await queue.close();
    });

    it("should stop the scheduler when closed", async () => {
        const queue = new Queue("test-queue", mockKodiak);

        vi.advanceTimersByTime(5000);
        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(1);

        await queue.close();

        vi.advanceTimersByTime(10000);
        expect(mockPromoteDelayedJobs).toHaveBeenCalledTimes(1);
    });

    it("should handle errors in scheduler loop", async () => {
        mockPromoteDelayedJobs.mockRejectedValueOnce(new Error("Redis error") as never);

        const queue = new Queue("test-queue", mockKodiak);
        const errorEmitter = vi.fn();
        queue.on("error", errorEmitter);

        vi.advanceTimersByTime(5000);

        await Promise.resolve();

        expect(mockPromoteDelayedJobs).toHaveBeenCalled();
        expect(errorEmitter).toHaveBeenCalledWith(expect.any(Error));

        await queue.close();
    });

    it("should ignore startScheduler if already running", () => {
        const queue = new Queue("test-queue", mockKodiak);

        const intervalBefore = (queue as unknown as { schedulerInterval: NodeJS.Timeout | null })
            .schedulerInterval;

        (queue as unknown as { startScheduler: () => void }).startScheduler();

        const intervalAfter = (queue as unknown as { schedulerInterval: NodeJS.Timeout | null })
            .schedulerInterval;

        expect(intervalBefore).toBe(intervalAfter);

        queue.close();
    });

    it("should call AddJobUseCase when adding a job", async () => {
        const queue = new Queue("test-queue", mockKodiak);
        const data = { foo: "bar" };

        await queue.add("job-1", data);

        expect(mockExecute).toHaveBeenCalledWith("job-1", data, undefined);

        await queue.close();
    });

    it("should handle close when schedulerInterval is null", async () => {
        const queue = new Queue("test-queue", mockKodiak);

        await queue.close();

        await expect(queue.close()).resolves.not.toThrow();
    });

    it("should call AddJobUseCase with options when provided", async () => {
        const queue = new Queue("test-queue", mockKodiak);
        const data = { foo: "bar" };
        const options = { priority: 5, attempts: 3 };

        await queue.add("job-2", data, options);

        expect(mockExecute).toHaveBeenCalledWith("job-2", data, options);

        await queue.close();
    });

    it("should log info when stalled jobs recovered", async () => {
        mockRecoverStalledJobs.mockResolvedValueOnce(["job-1"] as never);

        let scheduledCb: (() => Promise<void>) | null = null;

        const setIntervalSpy = vi.spyOn(global, "setInterval").mockImplementation(((
            cb: (...args: unknown[]) => void,
        ): NodeJS.Timeout => {
            scheduledCb = cb as () => Promise<void>;
            return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval);

        const queue = new Queue("test-queue", mockKodiak);

        if (typeof scheduledCb === "function") {
            await (scheduledCb as () => Promise<void>)();
        }

        // ensure the recovery path was invoked
        expect(mockRecoverStalledJobs).toHaveBeenCalled();

        setIntervalSpy.mockRestore();

        await queue.close();
    });

    it("should handle errors in Error during recoverStalledJobs for queue", async () => {
        mockRecoverStalledJobs.mockRejectedValueOnce(new Error("Redis error") as never);

        let scheduledCb: (() => Promise<void>) | null = null;

        const setIntervalSpy = vi.spyOn(global, "setInterval").mockImplementation(((
            cb: (...args: unknown[]) => void,
        ): NodeJS.Timeout => {
            scheduledCb = cb as () => Promise<void>;
            return 1 as unknown as NodeJS.Timeout;
        }) as typeof setInterval);

        const queue = new Queue("test-queue", mockKodiak);
        const errorEmitter = vi.fn();
        queue.on("error", errorEmitter);

        if (typeof scheduledCb === "function") {
            await (scheduledCb as () => Promise<void>)();
        }

        expect(errorEmitter).toHaveBeenCalledWith(expect.any(Error));

        setIntervalSpy.mockRestore();

        await queue.close();
    });

    it("should accept serializer directly as fourth parameter", async () => {
        const customSerializer = {
            serialize: vi.fn(),
            deserialize: vi.fn(),
        };
        const queue = new Queue("test-queue", mockKodiak, undefined, customSerializer);
        expect(queue).toBeDefined();
        await queue.close();
    });

    it("should accept limiter in options as fourth parameter", async () => {
        const queue = new Queue("test-queue", mockKodiak, undefined, {
            limiter: { max: 10, duration: 1000 },
        });
        expect(queue).toBeDefined();
        await queue.close();
    });

    it("should accept pipelining in options without limiter as fourth parameter", async () => {
        const queue = new Queue("test-queue", mockKodiak, undefined, {
            pipelining: { maxBatch: 10 },
        });
        expect(queue).toBeDefined();
        await queue.close();
    });

    it("should return a JobBuilder via job method and allow adding a job", async () => {
        const queue = new Queue("test-queue", mockKodiak);
        const builder = queue.job("job-builder-1", { foo: "bar" });
        expect(builder).toBeInstanceOf(JobBuilder);
        await builder.priority(3).add();
        expect(mockExecute).toHaveBeenCalledWith("job-builder-1", { foo: "bar" }, { priority: 3 });
        await queue.close();
    });
});
