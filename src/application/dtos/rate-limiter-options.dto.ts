/**
 * Configuration options for Token Bucket rate limiting.
 */
export interface RateLimiterOptions {
    /**
     * Maximum number of jobs/tokens allowed within the duration window.
     */
    max: number;

    /**
     * Duration window in milliseconds (e.g. 1000 for 1 second, 60000 for 1 minute).
     */
    duration: number;

    /**
     * Burst capacity: maximum tokens the bucket can hold at any instantaneous moment.
     * Defaults to `max`.
     */
    burst?: number;

    /**
     * Action to take when rate limit is exceeded upon fetching:
     * - "delay": Atomically moves the waiting job to the delayed queue with a short delay (default).
     * - "reject": Leaves the job in waiting queue and returns empty/null without consuming.
     * Defaults to "delay".
     */
    onExceeded?: "delay" | "reject";

    /**
     * Delay in milliseconds to set when moving an exceeded job to the delayed queue.
     * Defaults to 500ms.
     */
    retryDelay?: number;

    /**
     * Alternative/convenience alias for tokens per second.
     */
    rate?: number;

    /**
     * Alternative/convenience alias for burst capacity.
     */
    capacity?: number;
}
