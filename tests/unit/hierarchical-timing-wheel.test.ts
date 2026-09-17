import { describe, expect, it, vi } from "vitest";
import {
    HierarchicalTimingWheel,
    TimingWheelLevel,
} from "../../src/infrastructure/timing-wheel/hierarchical-timing-wheel.js";

describe("HierarchicalTimingWheel", () => {
    it("should schedule and execute a task upon time advance", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const cb = vi.fn();

        wheel.schedule("timer-1", 50, cb);
        expect(wheel.size()).toBe(1);

        // Advance only 30ms -> should not trigger yet
        wheel.advance(1030);
        expect(cb).not.toHaveBeenCalled();

        // Advance to 1060ms -> should trigger
        const fired = wheel.advance(1060);
        expect(fired).toBe(1);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(wheel.size()).toBe(0);
    });

    it("should handle multi-level cascades for longer delays and reinsert when not yet due", () => {
        // wheelSize: 10, tickMs: 10 -> Level 0 spans 100ms.
        // A 250ms delay goes into Level 1 (ticks of 100ms).
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 10, startMs: 0 });
        const cb = vi.fn();

        wheel.schedule("long-timer", 250, cb);
        expect(wheel.size()).toBe(1);

        // Advance past level 0 limit into level 1 tick (currentTime becomes 100 on level 0, triggers overflow advance)
        // At nowMs = 200, level 1 advances bucket (200), task has deadlineMs = 250, so deadlineMs > nowMs.
        // It cascades down and gets re-inserted into level 0 (line 81).
        wheel.advance(200);
        expect(cb).not.toHaveBeenCalled();

        // Advance to trigger time
        wheel.advance(260);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(wheel.size()).toBe(0);
    });

    it("should place task in current tick bucket when delay is less than tickMs", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const cb = vi.fn();

        wheel.schedule("immediate", 0, cb);
        wheel.schedule("negative", -5, cb);
        expect(wheel.size()).toBe(2);

        wheel.advance(1015);
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it("should cancel previous task if rescheduled with same id", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const cb1 = vi.fn();
        const cb2 = vi.fn();

        wheel.schedule("task-dup", 50, cb1);
        wheel.schedule("task-dup", 50, cb2);
        expect(wheel.size()).toBe(1);

        wheel.advance(1060);
        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    it("should cancel a scheduled task before expiry via cancel method and handle.cancel", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const cb1 = vi.fn();
        const cb2 = vi.fn();

        const handle1 = wheel.schedule("cancel-me-1", 40, cb1);
        const handle2 = wheel.schedule("cancel-me-2", 40, cb2);
        expect(handle1.cancelled).toBe(false);
        expect(handle2.cancelled).toBe(false);

        const cancelled1 = wheel.cancel("cancel-me-1");
        expect(cancelled1).toBe(true);
        expect(handle1.cancelled).toBe(true);

        // Cancelling again returns false
        expect(wheel.cancel("cancel-me-1")).toBe(false);
        expect(wheel.cancel("non-existent")).toBe(false);

        // Cancel via handle
        handle2.cancel();
        expect(handle2.cancelled).toBe(true);
        expect(wheel.size()).toBe(0);

        wheel.advance(1100);
        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).not.toHaveBeenCalled();
    });

    it("should catch errors thrown by callbacks without interrupting the wheel", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const errorCb = () => {
            throw new Error("Callback exploded");
        };
        const normalCb = vi.fn();

        wheel.schedule("error-task", 20, errorCb);
        wheel.schedule("normal-task", 20, normalCb);

        const executed = wheel.advance(1030);
        expect(executed).toBe(1);
        expect(normalCb).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });

    it("should clear all timers on clear()", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const cb = vi.fn();

        wheel.schedule("t1", 20, cb);
        wheel.schedule("t2", 40, cb);
        expect(wheel.size()).toBe(2);

        wheel.clear();
        expect(wheel.size()).toBe(0);

        wheel.advance(1100);
        expect(cb).not.toHaveBeenCalled();
    });

    it("should insert 10,000 timers in O(1) time without degradation", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 0 });
        const count = 10000;
        const noop = () => {};

        const t0 = performance.now();
        for (let i = 0; i < count; i++) {
            wheel.schedule(`t-${i}`, (i % 5000) + 10, noop);
        }
        const insertDurationMs = performance.now() - t0;

        expect(wheel.size()).toBe(count);
        // 10k O(1) insertions in JS typically take < 25ms, allow up to 200ms for AST coverage instrumentation
        expect(insertDurationMs).toBeLessThan(200);
    });

    it("should instantiate with default options and advance with default nowMs", () => {
        const dateNowSpy = vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValue(1050);
        const wheel = new HierarchicalTimingWheel();
        expect(wheel.size()).toBe(0);

        const cb = vi.fn();
        wheel.schedule("default-task", 0, cb);
        // Advance using default Date.now()
        wheel.advance();
        expect(cb).toHaveBeenCalled();
        dateNowSpy.mockRestore();
    });

    it("should ignore cancelled task inside TimingWheelLevel.add", () => {
        const level = new TimingWheelLevel(10, 10, 0);
        level.add({ id: "cancelled-task", deadlineMs: 50, callback: () => {}, cancelled: true });
        expect(level.buckets.size).toBe(0);
    });

    it("should skip task if it is cancelled during execution of an earlier task in the same bucket", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const cb2 = vi.fn();
        const cb1 = vi.fn(() => {
            wheel.cancel("task-2");
        });

        wheel.schedule("task-1", 10, cb1);
        wheel.schedule("task-2", 10, cb2);

        wheel.advance(1020);
        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).not.toHaveBeenCalled();
    });
});
