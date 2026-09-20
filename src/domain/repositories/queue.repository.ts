import type { Job } from "../entities/job.entity.js";

export interface BatchCompletedJob {
    jobId: string;
    completedAt: Date;
    ownerToken?: string;
}

export interface IDLQRepository<T> {
    getFailedCount(): Promise<number>;
    getFailedJobs(start?: number, limit?: number): Promise<Job<T>[]>;
    retryJob(jobId: string): Promise<boolean>;
    retryAllFailed(limit?: number): Promise<number>;
    cleanFailed(olderThanMs?: number): Promise<number>;
}

export interface IRateLimitStatus {
    tokens: number;
    max: number;
    duration: number;
    resetAt?: Date;
}

export interface IRateLimiterRepository {
    consumeRateLimit(count: number): Promise<boolean>;
    getRateLimitStatus(): Promise<IRateLimitStatus | null>;
}

export interface AddJobResult {
    isDuplicate: boolean;
    jobId: string;
}

export interface DeduplicationOptions {
    id?: string;
    ttl?: number;
    strategy?: "ignore-if-exists" | "throw";
}

/**
 * Auto-pipelining micro-batching configuration options for Redis / Dragonfly commands.
 */
export interface PipeliningOptions {
    /**
     * Whether auto-pipelining is enabled. Default: true
     */
    enabled?: boolean;
    /**
     * Maximum number of commands/operations accumulated before triggering an immediate pipeline flush.
     */
    maxBatch?: number;
    /**
     * Maximum time in milliseconds to wait before flushing pending pipeline commands.
     */
    maxWaitMs?: number;
    /**
     * Alias for maxWaitMs: maximum time in milliseconds to wait before flushing pending pipeline commands.
     */
    flushIntervalMs?: number;
}

export interface IQueueRepository<T>
    extends Partial<IDLQRepository<T>>,
        Partial<IRateLimiterRepository> {
    add(
        job: Job<T>,
        score: number,
        isDelayed: boolean,
        deduplication?: { id: string; ttl: number },
    ): Promise<AddJobResult | void>;
    fetchNext(timeout?: number): Promise<Job<T> | null>;
    fetchNextJobs(count: number, lockDuration: number, ownerToken?: string): Promise<Job<T>[]>;
    markAsCompleted(jobId: string, completedAt: Date, ownerToken?: string): Promise<void>;
    markManyAsCompleted?(jobs: BatchCompletedJob[]): Promise<void>;
    markAsFailed(
        jobId: string,
        error: string,
        failedAt: Date,
        nextAttempt?: Date,
        ownerToken?: string,
        errorStack?: string,
    ): Promise<void>;
    updateProgress(jobId: string, progress: number): Promise<void>;
    promoteDelayedJobs(limit?: number): Promise<number>;
    recoverStalledJobs(): Promise<string[]>;
    extendLock(jobId: string, lockExpiresAt: number, ownerToken?: string): Promise<boolean>;
    releaseJobs(jobIds: string[]): Promise<void>;
    deleteDeduplicationKey?(dedupId: string): Promise<boolean>;
}
