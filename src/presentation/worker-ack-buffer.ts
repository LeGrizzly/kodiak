import type { CompleteJobUseCase } from "../application/use-cases/complete-job.use-case.js";
import type { Job } from "../domain/entities/job.entity.js";

export interface WorkerAckItem<T> {
    job: Job<T>;
    ownerToken?: string;
    completedAt: Date;
    resolve: () => void;
    reject: (error: Error) => void;
}

export interface WorkerAckBufferOptions<T> {
    maxBatch?: number;
    maxWaitMs?: number;
    onCompleted?: (job: Job<T>) => void;
    onError?: (error: Error) => void;
    onBatchFlushed?: (count: number, durationMs: number) => void;
}

/**
 * High-performance buffer for job completions.
 * Batches acknowledgments into pipelined operations to eliminate network round-trips.
 */
export class WorkerAckBuffer<T> {
    private readonly pending: WorkerAckItem<T>[] = [];
    private flushScheduled = false;
    private readonly maxBatch: number;
    private readonly maxWaitMs: number;
    private isFlushing = false;

    constructor(
        private readonly completeJobUseCase: CompleteJobUseCase<T>,
        private readonly options?: WorkerAckBufferOptions<T>,
    ) {
        this.maxBatch = options?.maxBatch ?? 100;
        this.maxWaitMs = options?.maxWaitMs ?? 0;
    }

    public get pendingCount(): number {
        return this.pending.length;
    }

    public push(job: Job<T>, ownerToken?: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.pending.push({
                job,
                ownerToken,
                completedAt: new Date(),
                resolve,
                reject,
            });

            if (this.pending.length >= this.maxBatch) {
                void this.flush();
            } else if (!this.flushScheduled) {
                this.scheduleFlush();
            }
        });
    }

    private scheduleFlush(): void {
        this.flushScheduled = true;
        if (this.maxWaitMs > 0) {
            const timer = setTimeout(() => {
                void this.flush();
            }, this.maxWaitMs);
            if (timer && typeof timer.unref === "function") timer.unref();
        } else {
            queueMicrotask(() => {
                void this.flush();
            });
        }
    }

    public async flush(): Promise<void> {
        if (this.isFlushing) return;
        this.isFlushing = true;

        try {
            while (this.pending.length > 0) {
                this.flushScheduled = false;
                const batch = this.pending.splice(0, this.maxBatch);
                if (batch.length === 0) break;

                const t0 = performance.now();
                try {
                    await this.completeJobUseCase.executeMany(
                        batch.map((item) => ({
                            jobId: item.job.id,
                            ownerToken: item.ownerToken,
                            completedAt: item.completedAt,
                        })),
                    );

                    const durationMs = performance.now() - t0;
                    this.options?.onBatchFlushed?.(batch.length, durationMs);

                    for (const item of batch) {
                        item.job.status = "completed";
                        item.job.completedAt = item.completedAt;
                        this.options?.onCompleted?.(item.job);
                        item.resolve();
                    }
                } catch (rawError) {
                    const error =
                        rawError instanceof Error ? rawError : new Error(String(rawError));
                    this.options?.onError?.(error);
                    for (const item of batch) {
                        item.reject(error);
                    }
                }
            }
        } finally {
            this.isFlushing = false;
        }
    }

    public async drain(): Promise<void> {
        while (this.pending.length > 0 || this.isFlushing) {
            await this.flush();
            if (this.isFlushing) {
                await new Promise((resolve) => setTimeout(resolve, 1));
            }
        }
    }
}
