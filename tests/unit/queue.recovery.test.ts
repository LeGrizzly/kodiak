import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Kodiak } from "../../src/presentation/kodiak.js";

let mockKodiak: Kodiak;

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

describe("Unit: Queue stalled recovery scheduler", () => {
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

    afterEach(async () => {
        vi.useRealTimers();
    });

    it("should call recoverStalledJobs periodically", async () => {
        const queue = new Queue("test-queue", mockKodiak);

        vi.advanceTimersByTime(5000);
        await Promise.resolve();

        expect(mockRecoverStalledJobs).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(5000);
        await Promise.resolve();

        expect(mockRecoverStalledJobs).toHaveBeenCalledTimes(2);

        await queue.close();
    });

    it("should emit info when stalled jobs are recovered", async () => {
        const queue = new Queue("test-queue", mockKodiak);
        const infoMessages: string[] = [];
        queue.on("info", (msg) => infoMessages.push(msg));

        mockRecoverStalledJobs.mockResolvedValueOnce(["job-stalled-1", "job-stalled-2"] as never);

        vi.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();

        expect(infoMessages).toHaveLength(1);
        expect(infoMessages[0]).toBe(
            "[Queue:test-queue] Recovered 2 stalled job(s): job-stalled-1, job-stalled-2",
        );

        await queue.close();
    });

    it("should emit error when promoteDelayedJobs fails", async () => {
        const queue = new Queue("test-queue", mockKodiak);
        const errors: Error[] = [];
        queue.on("error", (err) => errors.push(err as Error));

        mockPromoteDelayedJobs.mockRejectedValueOnce(new Error("Promote failure") as never);

        vi.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();

        expect(errors).toHaveLength(1);
        expect(errors[0]?.message).toBe("Promote failure");

        await queue.close();
    });

    it("should emit error when recoverStalledJobs fails", async () => {
        const queue = new Queue("test-queue", mockKodiak);
        const errors: Error[] = [];
        queue.on("error", (err) => errors.push(err as Error));

        mockRecoverStalledJobs.mockRejectedValueOnce(new Error("Recovery failure") as never);

        vi.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();

        expect(errors).toHaveLength(1);
        expect(errors[0]?.message).toBe("Recovery failure");

        await queue.close();
    });

    it("should prevent overlapping execution of recoverStalledJobs", async () => {
        const queue = new Queue("test-queue", mockKodiak);

        let resolvePromise!: () => void;
        const hangingPromise = new Promise<string[]>((res) => {
            resolvePromise = () => res([]);
        });

        mockRecoverStalledJobs.mockReturnValueOnce(hangingPromise as never);

        // Tick 1: enters recoverStalledJobs and sets recoveringStalledJobs = true
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
        expect(mockRecoverStalledJobs).toHaveBeenCalledTimes(1);

        // Tick 2: recoveringStalledJobs is still true, should return early
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
        expect(mockRecoverStalledJobs).toHaveBeenCalledTimes(1);

        // Finish tick 1
        resolvePromise();
        await Promise.resolve();
        await Promise.resolve();

        // Tick 3: now recoveringStalledJobs is false, can run again
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
        expect(mockRecoverStalledJobs).toHaveBeenCalledTimes(2);

        await queue.close();
    });

    it("should safely handle scheduler when unref is not a function", async () => {
        const fakeTimer = { [Symbol.toPrimitive]: () => 123 } as unknown as NodeJS.Timeout;
        vi.spyOn(global, "setInterval").mockReturnValueOnce(fakeTimer);

        const queue = new Queue("test-queue", mockKodiak);
        expect(queue).toBeDefined();

        await queue.close();
    });

    it("should return early if startScheduler is called when interval already exists", async () => {
        const queue = new Queue("test-queue", mockKodiak);
        const privateQueue = queue as unknown as {
            startScheduler: () => void;
            schedulerInterval: unknown;
        };
        const existingInterval = privateQueue.schedulerInterval;

        privateQueue.startScheduler();
        expect(privateQueue.schedulerInterval).toBe(existingInterval);

        await queue.close();
    });
});
