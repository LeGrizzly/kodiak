export type JobStatus = "waiting" | "active" | "completed" | "failed" | "delayed";

export type BackoffStrategyType = "fixed" | "exponential" | string;

export interface JobErrorInfo {
    error: string;
    failedAt: Date;
    stack?: string;
}

export interface Job<T> {
    id: string;
    data: T;
    status: JobStatus;
    priority: number;
    addedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    failedAt?: Date;
    retryCount: number;
    maxAttempts: number;
    backoff?: {
        type: BackoffStrategyType;
        delay: number;
    };
    repeat?: {
        every: number;
        limit?: number;
        count: number;
    };
    error?: string;
    errorHistory?: JobErrorInfo[];
    traceparent?: string;
    progress?: number;
    processedAt?: Date;
    isDuplicate?: boolean;
    updateProgress?: (progress: number) => Promise<void>;
}
