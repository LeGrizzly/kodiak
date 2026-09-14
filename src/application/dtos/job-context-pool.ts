import type { Job } from "../../domain/entities/job.entity.js";
import type { IJobLogger, JobContext } from "./job-context.dto.js";

export interface JobContextPoolOptions {
    heartbeatFactory?: () => (jobId: string, ownerToken?: string) => Promise<boolean>;
    updateProgressFactory?: () => (jobId: string, progress: number) => Promise<void>;
}

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

    public heartbeat = async (): Promise<boolean> => {
        if (this.heartbeatFn) {
            return this.heartbeatFn(this.currentJobId, this.currentOwnerToken);
        }
        return false;
    };

    public updateProgress = async (progress: number): Promise<void> => {
        if (this.updateProgressFn) {
            await this.updateProgressFn(this.currentJobId, progress);
            if (this.job) {
                this.job.progress = progress;
            }
        }
    };

    public reset(job: Job<T>, ownerToken?: string): void {
        this.job = job;
        this.data = job.data;
        this.currentJobId = job.id;
        this.currentOwnerToken = ownerToken;
    }
}

export class JobContextPool<T> {
    private readonly pool: PooledJobContext<T>[] = [];
    private readonly inUse = new Set<PooledJobContext<T>>();

    constructor(
        private readonly queueName: string,
        private readonly options: JobContextPoolOptions = {},
    ) {}

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

    public release(context: PooledJobContext<T>): void {
        if (this.inUse.has(context)) {
            this.inUse.delete(context);
            this.pool.push(context);
        }
    }

    public availableCount(): number {
        return this.pool.length;
    }

    public inUseCount(): number {
        return this.inUse.size;
    }

    public clear(): void {
        this.pool.length = 0;
        this.inUse.clear();
    }
}
