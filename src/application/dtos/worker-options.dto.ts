import type { IJobSerializer } from "../../domain/serializers/job-serializer.interface.js";
import type { BackoffStrategy } from "../../domain/strategies/backoff.strategy.js";
import type { RateLimiterOptions } from "./rate-limiter-options.dto.js";

/**
 * Configuration options for adaptive prefetching.
 * Dynamically scales the batch fetch size according to queue backlog and worker throughput.
 *
 * @example
 * ```ts
 * const prefetchOpts: AdaptivePrefetchOptions = {
 *     min: 10,
 *     max: 150,
 *     scaleUpFactor: 1.5,
 * };
 * ```
 */
export interface AdaptivePrefetchOptions {
    /**
     * Minimum batch size to fetch per iteration.
     * Default: Math.max(concurrency * 5, 20)
     */
    min?: number;

    /**
     * Maximum batch size to fetch under sustained queue backlog.
     * Default: 100
     */
    max?: number;

    /**
     * Scale-up multiplier applied when a full batch is retrieved.
     * Default: 2
     */
    scaleUpFactor?: number;
}

/**
 * Options for ACK pipelining and micro-batching.
 * Buffers job completions and acknowledges them in bulk pipelines to minimize network round-trips.
 *
 * @example
 * ```ts
 * const ackOpts: WorkerAckPipeliningOptions = {
 *     enabled: true,
 *     maxBatch: 100,
 *     maxWaitMs: 5,
 * };
 * ```
 */
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
 * Configuration options for worker behavior, lifecycle management,
 * concurrency, prefetching, rate limiting, and backpressure.
 *
 * @example
 * ### 1. High-Throughput Batching Worker
 * ```ts
 * const worker = kodiak.createWorker("heavy-tasks", async (job) => {
 *     await processTask(job.data);
 * }, {
 *     concurrency: 20,
 *     prefetch: { min: 20, max: 200, scaleUpFactor: 2 },
 *     ackPipelining: { maxBatch: 100, maxWaitMs: 2 },
 *     removeOnSuccess: true, // Auto-delete completed keys
 *     sendEvents: false,     // Disable event emission for maximum speed
 * });
 * ```
 *
 * @example
 * ### 2. Resilient Worker with Heartbeat & Backpressure Credits
 * ```ts
 * const worker = kodiak.createWorker("long-jobs", async (job) => {
 *     await performLongOperation(job.data);
 * }, {
 *     concurrency: 5,
 *     lockDuration: 60_000,
 *     heartbeatEnabled: true,
 *     heartbeatInterval: 10_000,
 *     credits: { maxCredits: 20, replenishBatchThreshold: 5 },
 *     gracefulShutdownTimeout: 30_000,
 * });
 * ```
 */
export interface WorkerOptions {
    /**
     * Maximum number of concurrent tasks processed by this worker.
     *
     * @default 1
     * @example 10
     */
    concurrency?: number;

    /**
     * Number of messages to prefetch per worker, or 'auto' / AdaptivePrefetchOptions
     * for dynamic auto-tuning based on traffic.
     *
     * @default 'auto'
     * @example
     * - 50 (fixed prefetch buffer)
     * - 'auto' (dynamically scales from 20 to 100)
     * - { min: 25, max: 200 }
     */
    prefetch?: number | "auto" | AdaptivePrefetchOptions;

    /**
     * Configures ACK pipelining / micro-batching.
     * Eliminates network round-trips by grouping completed jobs into single pipeline executions.
     *
     * @default true
     */
    ackPipelining?: boolean | WorkerAckPipeliningOptions;

    /**
     * Lock duration in milliseconds for a claimed task before it is considered stalled.
     *
     * @default 30000 (30 seconds)
     * @example 60000
     */
    lockDuration?: number;

    /**
     * Time in milliseconds to wait for in-flight tasks to finish during graceful shutdown.
     *
     * @default 30000 (30 seconds)
     * @example 15000
     */
    gracefulShutdownTimeout?: number;

    /**
     * Map of named backoff strategies used for retrying failed tasks.
     *
     * @default {}
     * @example
     * ```ts
     * const backoffStrategies = {
     *     exponential: (attempts, delay) => delay * Math.pow(2, attempts - 1),
     *     jitter: (attempts, delay) => delay + Math.random() * 1000,
     * };
     * ```
     */
    backoffStrategies?: Record<string, BackoffStrategy>;

    /**
     * Enable or disable the heartbeat mechanism that periodically refreshes job lock TTL in Redis.
     * Recommended for jobs whose execution duration is unpredictable or may exceed lockDuration.
     *
     * @default false
     * @example true
     */
    heartbeatEnabled?: boolean;

    /**
     * Interval in milliseconds between heartbeat lock extension calls.
     *
     * @default Math.max(1000, lockDuration/2)
     * @example 5000
     */
    heartbeatInterval?: number;

    /**
     * Custom serializer for decoding job data payloads.
     * Defaults to the Kodiak instance serializer.
     */
    serializer?: IJobSerializer;

    /**
     * Enables detailed internal execution telemetry (timings for fetch, processing, ACK, idle).
     * Useful for diagnostics, profiling, and performance benchmarks.
     *
     * @default false
     */
    telemetry?: boolean;

    /**
     * Credit-based reactive backpressure configuration.
     * Prevents worker memory saturation (OOM) by capping in-flight and prefetched jobs.
     *
     * @example
     * - 50 (max 50 concurrent in-flight credits)
     * - { maxCredits: 100, replenishBatchThreshold: 20 }
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

    /**
     * Disable if this worker does not need to send job events back to other queues.
     * Setting to false skips event emission on this worker instance, maximizing throughput.
     * Inherited from QueueOptions if not explicitly set.
     *
     * @default true
     */
    sendEvents?: boolean;

    /**
     * Disable if this worker does not need to associate events with specific Job instances.
     * This normally improves memory usage, as the storage of jobs is unnecessary for many use-cases.
     * Inherited from QueueOptions if not explicitly set.
     *
     * @default true
     */
    storeJobs?: boolean;

    /**
     * Enable to have this worker automatically remove its successfully completed jobs from Redis,
     * so as to keep memory usage down.
     * Inherited from QueueOptions if not explicitly set.
     *
     * @default false
     */
    removeOnSuccess?: boolean;

    /**
     * Enable to have this worker automatically remove its failed jobs from Redis,
     * so as to keep memory usage down. This will not remove jobs that are set to retry
     * unless they fail all their retries.
     * Inherited from QueueOptions if not explicitly set.
     *
     * @default false
     */
    removeOnFailure?: boolean;
}
