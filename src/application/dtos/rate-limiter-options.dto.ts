/**
 * Configuration options for Token Bucket rate limiting.
 *
 * Kodiak implements an atomic Token Bucket algorithm directly in Redis Lua,
 * providing strict rate enforcement across distributed workers and queues.
 *
 * @example
 * ### 1. API Rate Limiting with Burst and Delay Backoff
 * Limit outgoing calls to 50 requests per second, tolerating bursts up to 80:
 * ```ts
 * const limiterOpts: RateLimiterOptions = {
 *     max: 50,
 *     duration: 1000,
 *     burst: 80,
 *     onExceeded: "delay",  // Move exceeded jobs to the delayed queue
 *     retryDelay: 250,      // Re-check after 250ms
 * };
 *
 * const queue = kodiak.createQueue("third-party-api", { rateLimiter: limiterOpts });
 * ```
 *
 * @example
 * ### 2. Strict Fast-Reject Limiting
 * Reject execution immediately when token limit is exhausted without delaying jobs:
 * ```ts
 * const limiterOpts: RateLimiterOptions = {
 *     max: 100,
 *     duration: 60_000, // 100 jobs per minute
 *     onExceeded: "reject",
 * };
 *
 * const worker = kodiak.createWorker("reports", processor, { rateLimiter: limiterOpts });
 * ```
 */
export interface RateLimiterOptions {
    /**
     * Maximum number of jobs/tokens allowed within the duration window.
     *
     * @example 100
     */
    max: number;

    /**
     * Duration window in milliseconds.
     *
     * @example
     * - 1000 (1 second)
     * - 60000 (1 minute)
     */
    duration: number;

    /**
     * Burst capacity: maximum tokens the bucket can hold at any instantaneous moment.
     * Allows handling traffic spikes while maintaining an average consumption rate.
     *
     * @default `max`
     * @example 150
     */
    burst?: number;

    /**
     * Action to take when rate limit is exceeded upon fetching:
     * - `"delay"`: Atomically moves the waiting job to the delayed queue with a retry delay (default).
     * - `"reject"`: Leaves the job in waiting queue and returns empty/null without consuming.
     *
     * @default "delay"
     * @example "delay"
     */
    onExceeded?: "delay" | "reject";

    /**
     * Delay in milliseconds applied when moving an exceeded job to the delayed queue.
     * Only applies when `onExceeded` is `"delay"`.
     *
     * @default 500
     * @example 250
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
