import type { IJobSerializer } from "../../domain/serializers/job-serializer.interface.js";
import type { BackoffStrategy } from "../../domain/strategies/backoff.strategy.js";
import type { RateLimiterOptions } from "./rate-limiter-options.dto.js";

export interface AdaptivePrefetchOptions {
    /**
     * Minimum batch size to fetch.
     * Default: Math.max(concurrency * 5, 20)
     */
    min?: number;

    /**
     * Maximum batch size to fetch under sustained backlog.
     * Default: 100
     */
    max?: number;

    /**
     * Scale-up multiplier when a full batch is retrieved.
     * Default: 2
     */
    scaleUpFactor?: number;
}

export interface WorkerAckPipeliningOptions {
    /**
     * Enable or disable ACK pipelining.
     * Default: true when configured
     */
    enabled?: boolean;

    /**
     * Maximum number of ACKs accumulated before triggering an immediate pipeline flush.
     * Default: 50
     */
    maxBatch?: number;

    /**
     * Maximum time in ms to wait before flushing pending ACKs.
     * Set to 0 to flush at the end of the current event loop microtask.
     * Default: 2 (ms)
     */
    maxWaitMs?: number;
}

/**
 * Configuration options for worker behavior.
 * All fields are optional.
 */
export interface WorkerOptions {
    /**
     * Maximum number of concurrent workers processing tasks.
     *
     * Optional. Default: 1
     *
     * Example: 5
     */
    concurrency?: number;

    /**
     * Number of messages to prefetch per worker, or 'auto' / AdaptivePrefetchOptions
     * for dynamic auto-tuning.
     *
     * Optional. Default: 'auto'
     *
     * Examples:
     * - 50 (fixed)
     * - 'auto' (dynamically scales from 20 to 100 based on backlog)
     * - { min: 25, max: 200 }
     */
    prefetch?: number | "auto" | AdaptivePrefetchOptions;

    /**
     * Configures ACK pipelining / micro-batching.
     * Eliminates network round-trips by grouping completed jobs into pipelines.
     *
     * Optional. Default: true (or configure with options)
     */
    ackPipelining?: boolean | WorkerAckPipeliningOptions;

    /**
     * Lock duration in milliseconds for a claimed task.
     *
     * Optional. Default: 30000 (30 seconds)
     *
     * Examples:
     * - 30000 (default, reasonable for short tasks)
     * - 60000 (longer tasks)
     * - 120000 (very long-running tasks)
     *
     * Usage:
     * ```ts
     * const opts: WorkerOptions = { lockDuration: 60000 };
     * ```
     */
    lockDuration?: number;

    /**
     * Time in milliseconds to wait for in-flight tasks to finish during shutdown.
     *
     * Optional. Default: 30000 (30 seconds)
     *
     * Examples:
     * - 15000 (short grace period)
     * - 30000 (default)
     * - 120000 (allow long jobs to finish)
     *
     * Usage:
     * ```ts
     * const opts: WorkerOptions = { gracefulShutdownTimeout: 120000 };
     * ```
     */
    gracefulShutdownTimeout?: number;

    /**
     * Map of named backoff strategies used for retrying tasks.
     *
     * Optional. Default: {}
     *
     * ```json
     * Example: {
     *  "exponential": myExponentialBackoff
     * }
     * ```
     *
     * More examples:
     * More examples (implementations must be functions matching BackoffStrategy:
     * ```ts
     * import type { BackoffStrategy } from "../../domain/strategies/backoff.strategy";
     *
     * const backoffStrategies: Record<string, BackoffStrategy> = {
     *   fixed: (attemptsMade, delay) => delay,
     *   exponential: (attemptsMade, delay) => delay * Math.pow(2, attemptsMade - 1),
     * };
     *
     * const opts: WorkerOptions = { backoffStrategies };
     * ```
     */
    backoffStrategies?: Record<string, BackoffStrategy>;

    /**
     * Enable or disable heartbeat mechanism that periodically extends locks.
     *
     * Optional. Default: false
     *
     * Examples:
     * - `false` (keep current stalled-detection only)
     * - `true` (enable heartbeat; worker will periodically refresh locks)
     *
     * Usage:
     * ```ts
     * const opts: WorkerOptions = { heartbeatEnabled: true };
     * ```
     */
    heartbeatEnabled?: boolean;

    /**
     * Interval in milliseconds between heartbeats.
     *
     * Optional. Default: Math.max(1000, lockDuration/2)
     *
     * Examples:
     * - 1000 (very frequent, higher Redis load)
     * - 5000 (balanced)
     * - 15000 (infrequent, suitable for long lockDuration)
     *
     * Usage:
     * ```ts
     * const opts: WorkerOptions = { heartbeatEnabled: true, heartbeatInterval: 5000 };
     * ```
     */
    heartbeatInterval?: number;

    /**
     * Custom serializer for decoding job data payloads.
     */
    serializer?: IJobSerializer;

    /**
     * Enables detailed internal execution telemetry (timings for fetch, processing, ACK, idle).
     * Useful for diagnostics, profiling and benchmarks.
     * Default: false
     */
    telemetry?: boolean;

    /**
     * Credit-based reactive backpressure configuration.
     * Prevents worker memory saturation (OOM) by capping in-flight and prefetched jobs.
     */
    credits?: number | { maxCredits: number; replenishBatchThreshold?: number };

    /**
     * Rate limiter configuration for the worker.
     * If specified, throttles job consumption according to the token-bucket algorithm.
     */
    rateLimiter?: RateLimiterOptions;

    /**
     * Alias for rateLimiter.
     */
    limiter?: RateLimiterOptions;
}
