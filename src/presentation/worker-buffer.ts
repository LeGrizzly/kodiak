import type { Job } from "../domain/entities/job.entity.js";
import { Semaphore } from "../utils/semaphore.js";

/**
 * In-memory prefetch buffer per worker slot.
 * Ensures zero-latency immediate processing from RAM without repeated network round-trips.
 */
export class WorkerBuffer<T> {
    private readonly buffers = new Map<number, Job<T>[]>();
    private readonly bufferLock = new Semaphore(1);

    public initSlot(slotIndex: number): void {
        this.buffers.set(slotIndex, []);
    }

    public getBufferedJob(slotIndex: number): Job<T> | null {
        const slotBuffer = this.buffers.get(slotIndex);
        if (slotBuffer && slotBuffer.length > 0) {
            const job = slotBuffer.shift();
            return job ?? null;
        }
        return null;
    }

    public async acquireLock(): Promise<void> {
        await this.bufferLock.acquire();
    }

    public releaseLock(): void {
        this.bufferLock.release();
    }

    public fillSlot(slotIndex: number, jobs: Job<T>[]): Job<T> | null {
        if (jobs.length === 0) return null;
        const remaining = jobs.slice();
        const nextJob = remaining.shift() ?? null;
        this.buffers.set(slotIndex, remaining);
        return nextJob;
    }
}
