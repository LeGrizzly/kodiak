import type { Job } from "../../domain/entities/job.entity.js";
import type { IJobLogger, JobContext } from "./job-context.dto.js";

/**
 * Options for configuring a JobContextPool instance.
 *
 * Supplies factory functions to bind atomic heartbeat and progress reporting
 * methods to recycled context instances.
 *
 * @example
 * ```ts
 * const poolOptions: JobContextPoolOptions = {
 *     heartbeatFactory: () => (jobId, token) => repo.extendLock(jobId, 30000, token),
 *     updateProgressFactory: () => (jobId, progress) => repo.updateProgress(jobId, progress),
 * };
 * const pool = new JobContextPool("emails", poolOptions);
 * ```
 */
export interface JobContextPoolOptions {
    /**
     * Factory generating a heartbeat function bound to the active queue repository.
     */
    heartbeatFactory?: () => (jobId: string, ownerToken?: string) => Promise<boolean>;

    /**
     * Factory generating an updateProgress function bound to the active queue repository.
     */
    updateProgressFactory?: () => (jobId: string, progress: number) => Promise<void>;
}

/**
 * Recyclable wrapper implementing `JobContext<T>`.
 *
 * Instantiated once per concurrency slot and reset on each job claim to avoid
 * garbage collector (GC) allocations on high-frequency execution loops.
 */
export class PooledJobContext<T> implements JobContext<T> {
    public job!: Job<T>;
    public data!: T;
    public logger: IJobLogger;
    public currentJobId = "";
    public currentOwnerToken?: string;

    private readonly heartbeatFn?: (jobId: string, ownerToken?: string) => Promise<boolean>;
    private readonly updateProgressFn?: (jobId: string, progress: number) => Promise<void>;

    constructor(
        queueName: string,
        heartbeatFn?: (jobId: string, ownerToken?: string) => Promise<boolean>,
        updateProgressFn?: (jobId: string, progress: number) => Promise<void>,
    ) {
        this.heartbeatFn = heartbeatFn;
        this.updateProgressFn = updateProgressFn;

        this.logger = {
            info: (msg, ...args) =>
                console.info(`[Kodiak:${queueName}:${this.currentJobId}] ${msg}`, ...args),
            warn: (msg, ...args) =>
                console.warn(`[Kodiak:${queueName}:${this.currentJobId}] ${msg}`, ...args),
            error: (msg, ...args) =>
                console.error(`[Kodiak:${queueName}:${this.currentJobId}] ${msg}`, ...args),
            debug: (msg, ...args) =>
                console.debug(`[Kodiak:${queueName}:${this.currentJobId}] ${msg}`, ...args),
        };
    }

    /**
     * Extends the lock duration for the current job execution.
     */
    public heartbeat = async (): Promise<boolean> => {
        if (this.heartbeatFn) {
            return this.heartbeatFn(this.currentJobId, this.currentOwnerToken);
        }
        return false;
    };

    /**
     * Updates execution progress (0-100%) for the current job.
     */
    public updateProgress = async (progress: number): Promise<void> => {
        if (this.updateProgressFn) {
            await this.updateProgressFn(this.currentJobId, progress);
            if (this.job) {
                this.job.progress = progress;
            }
        }
    };

    /**
     * Re-binds this pooled context to a newly claimed Job instance.
     */
    public reset(job: Job<T>, ownerToken?: string): void {
        this.job = job;
        this.data = job.data;
        this.currentJobId = job.id;
        this.currentOwnerToken = ownerToken;
    }
}

/**
 * Object pool for `JobContext<T>` instances.
 *
 * Under extreme throughput (tens of thousands of jobs per second), creating a new
 * context object with closures for every job creates significant GC allocation churn.
 * This pool recycles contexts to achieve near-zero GC pause overhead.
 *
 * @example
 * ```ts
 * const pool = new JobContextPool<OrderPayload>("orders");
 * const context = pool.acquire(job, "worker-token-123");
 * try {
 *     await processor(context);
 * } finally {
 *     pool.release(context);
 * }
 * ```
 */
export class JobContextPool<T> {
    private readonly pool: PooledJobContext<T>[] = [];
    private readonly inUse = new Set<PooledJobContext<T>>();

    constructor(
        private readonly queueName: string,
        private readonly options: JobContextPoolOptions = {},
    ) {}

    /**
     * Acquires a pooled context, re-initialized with the specified job and owner token.
     */
    public acquire(job: Job<T>, ownerToken?: string): PooledJobContext<T> {
        let context = this.pool.pop();

        if (!context) {
            context = new PooledJobContext<T>(
                this.queueName,
                this.options.heartbeatFactory?.(),
                this.options.updateProgressFactory?.(),
            );
        }

        context.reset(job, ownerToken);
        this.inUse.add(context);
        return context;
    }

    /**
     * Returns an acquired context back to the idle pool for future reuse.
     */
    public release(context: PooledJobContext<T>): void {
        if (this.inUse.has(context)) {
            this.inUse.delete(context);
            this.pool.push(context);
        }
    }

    /**
     * Returns the count of idle contexts ready for acquisition.
     */
    public availableCount(): number {
        return this.pool.length;
    }

    /**
     * Returns the count of contexts currently checked out and processing jobs.
     */
    public inUseCount(): number {
        return this.inUse.size;
    }

    /**
     * Clears all cached pooled contexts.
     */
    public clear(): void {
        this.pool.length = 0;
        this.inUse.clear();
    }
}
