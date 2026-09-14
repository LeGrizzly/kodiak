import type { AdaptivePrefetchOptions } from "../application/dtos/worker-options.dto.js";

/**
 * Manages adaptive prefetch batch sizing for workers.
 * Dynamically scales up under sustained backlog and down when the queue drains.
 */
export class AdaptivePrefetchManager {
    private currentSize: number;
    private readonly min: number;
    private readonly max: number;
    private readonly scaleUpFactor: number;
    private readonly isAdaptive: boolean;

    constructor(concurrency: number, options?: number | "auto" | AdaptivePrefetchOptions) {
        if (typeof options === "number") {
            this.currentSize = Math.max(1, options);
            this.min = this.currentSize;
            this.max = this.currentSize;
            this.scaleUpFactor = 1;
            this.isAdaptive = false;
            return;
        }

        const opts = typeof options === "object" ? options : {};
        this.min = opts.min ?? Math.max(concurrency * 5, 20);
        this.max = opts.max ?? 100;
        this.scaleUpFactor = opts.scaleUpFactor ?? 2;
        this.currentSize = this.min;
        this.isAdaptive = true;
    }

    public getSize(): number {
        return this.currentSize;
    }

    public recordFetchResult(fetchedCount: number): void {
        if (!this.isAdaptive) return;

        if (fetchedCount >= this.currentSize) {
            this.currentSize = Math.min(
                this.max,
                Math.max(this.min, Math.round(this.currentSize * this.scaleUpFactor)),
            );
        } else if (fetchedCount === 0 || fetchedCount < Math.floor(this.currentSize / 2)) {
            this.currentSize = Math.max(this.min, Math.floor(this.currentSize / 2));
        }
    }
}
