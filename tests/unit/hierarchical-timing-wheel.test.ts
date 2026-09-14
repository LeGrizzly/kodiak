import { describe, expect, it, jest } from "@jest/globals";
import { HierarchicalTimingWheel } from "../../src/infrastructure/timing-wheel/hierarchical-timing-wheel.js";

describe("HierarchicalTimingWheel", () => {
    it("should schedule and execute a task upon time advance", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const cb = jest.fn();

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

    it("should handle multi-level cascades for longer delays", () => {
        // wheelSize: 10, tickMs: 10 -> Level 0 spans 100ms.
        // A 250ms delay goes into Level 1 (ticks of 100ms).
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 10, startMs: 0 });
        const cb = jest.fn();

        wheel.schedule("long-timer", 250, cb);
        expect(wheel.size()).toBe(1);

        // Advance past level 0 limit
        wheel.advance(150);
        expect(cb).not.toHaveBeenCalled();

        // Advance to trigger time
        wheel.advance(260);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(wheel.size()).toBe(0);
    });

    it("should cancel a scheduled task before expiry", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const cb = jest.fn();

        const handle = wheel.schedule("cancel-me", 40, cb);
        expect(handle.cancelled).toBe(false);

        const cancelled = wheel.cancel("cancel-me");
        expect(cancelled).toBe(true);
        expect(handle.cancelled).toBe(true);
        expect(wheel.size()).toBe(0);

        wheel.advance(1100);
        expect(cb).not.toHaveBeenCalled();
    });

    it("should clear all timers on clear()", () => {
        const wheel = new HierarchicalTimingWheel({ tickMs: 10, wheelSize: 64, startMs: 1000 });
        const cb = jest.fn();

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
        // 10k O(1) insertions in JS typically take < 25ms
        expect(insertDurationMs).toBeLessThan(50);
    });
});
