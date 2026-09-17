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

export interface IQueueRepository<T> extends Partial<IDLQRepository<T>> {
    add(job: Job<T>, score: number, isDelayed: boolean): Promise<void>;
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
}
