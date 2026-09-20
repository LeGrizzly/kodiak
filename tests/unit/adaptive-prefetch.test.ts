import { describe, expect, it } from "vitest";
import { AdaptivePrefetchManager } from "../../src/presentation/adaptive-prefetch.js";

describe("AdaptivePrefetchManager", () => {
    it("should handle fixed numeric prefetch", () => {
        const manager = new AdaptivePrefetchManager(5, 30);
        expect(manager.getSize()).toBe(30);

        // Recording results should not change size in fixed mode
        manager.recordFetchResult(30);
        expect(manager.getSize()).toBe(30);
        manager.recordFetchResult(0);
        expect(manager.getSize()).toBe(30);
    });

    it("should initialize default adaptive values based on concurrency", () => {
        const manager = new AdaptivePrefetchManager(5); // concurrency: 5
        // min should be max(5 * 5, 20) = 25
        expect(manager.getSize()).toBe(25);
    });

    it("should scale up when a full batch is retrieved", () => {
        const manager = new AdaptivePrefetchManager(2, { min: 20, max: 100, scaleUpFactor: 2 });
        expect(manager.getSize()).toBe(20);

        manager.recordFetchResult(20); // full batch
        expect(manager.getSize()).toBe(40);

        manager.recordFetchResult(40); // full batch
        expect(manager.getSize()).toBe(80);

        manager.recordFetchResult(80); // full batch -> should cap at max: 100
        expect(manager.getSize()).toBe(100);

        manager.recordFetchResult(100);
        expect(manager.getSize()).toBe(100);
    });

    it("should scale down when batch is empty or below half", () => {
        const manager = new AdaptivePrefetchManager(2, { min: 20, max: 100 });
        manager.recordFetchResult(20); // scales to 40
        expect(manager.getSize()).toBe(40);

        manager.recordFetchResult(5); // below half of 40 (which is 20)
        expect(manager.getSize()).toBe(20);

        manager.recordFetchResult(0); // empty batch -> should not go below min
        expect(manager.getSize()).toBe(20);
    });

    it("should maintain current size if batch is partial but above half", () => {
        const manager = new AdaptivePrefetchManager(2, { min: 20, max: 100 });
        manager.recordFetchResult(20); // scales to 40
        expect(manager.getSize()).toBe(40);

        manager.recordFetchResult(30); // 30 is < 40 but >= 20 (half)
        expect(manager.getSize()).toBe(40);
    });
});
