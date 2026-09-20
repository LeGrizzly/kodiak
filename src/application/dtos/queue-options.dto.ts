import type {
    DeduplicationOptions,
    PipeliningOptions,
} from "../../domain/repositories/queue.repository.js";
import type { IJobSerializer } from "../../domain/serializers/job-serializer.interface.js";
import type { RateLimiterOptions } from "./rate-limiter-options.dto.js";

/**
 * Configuration options for initializing a Kodiak Queue instance.
 *
 * Controls serialization, write pipelining, rate limiting, deduplication,
 * Redis key lifecycle management, and event subscription/emission behaviors.
 *
 * @example
 * ### 1. Basic Queue Configuration
 * ```ts
 * import { Kodiak } from "@xalsie/kodiak";
 *
 * const kodiak = new Kodiak({ connection: { host: "localhost", port: 6379 } });
 * const queue = kodiak.createQueue("emails", {
 *     removeOnSuccess: true, // Auto-delete keys after successful completion
 * });
 * ```
 *
 * @example
 * ### 2. Ultra-Lean High-Throughput Queue (Zero Event Overhead & Key Cleanup)
 * For high-volume workloads (e.g. log ingestion, analytics aggregation) where
 * event listeners are not required and memory conservation is critical:
 * ```ts
 * const queue = kodiak.createQueue("analytics-events", {
 *     // Disable event subscriptions and emissions to minimize CPU and event-loop overhead
 *     getEvents: false,
 *     sendEvents: false,
 *     storeJobs: false,
 *
 *     // Automatically remove completed and exhausted failed jobs from Redis to keep memory down
 *     removeOnSuccess: true,
 *     removeOnFailure: true,
 *
 *     // Enable auto-pipelining micro-batching for maximum ingestion throughput
 *     pipelining: {
 *         maxBatch: 100,
 *         maxWaitMs: 5,
 *     },
 * });
 * ```
 *
 * @example
 * ### 3. Rate-Limited Queue with Idempotent Deduplication
 * ```ts
 * const queue = kodiak.createQueue("payment-webhooks", {
 *     // Token-bucket rate limiter: max 50 jobs per second with burst up to 100
 *     rateLimiter: {
 *         max: 50,
 *         duration: 1000,
 *         burst: 100,
 *         onExceeded: "delay",
 *     },
 *     // Automatic deduplication with 60-second sliding window
 *     deduplication: {
 *         ttl: 60_000,
 *         strategy: "ignore-if-exists",
 *     },
 * });
 * ```
 */
export interface QueueOptions {
    /**
     * Custom serializer for encoding and decoding job payload data.
     *
     * Defaults to the Kodiak instance serializer (MsgpackJobSerializer).
     *
     * @example
     * ```ts
     * const opts: QueueOptions = { serializer: new CustomJsonSerializer() };
     * ```
     */
    serializer?: IJobSerializer;

    /**
     * Configuration for write auto-pipelining and micro-batching.
     * Accumulates rapid job insertions into pipelines to dramatically reduce network round-trips.
     *
     * @example
     * ```ts
     * const opts: QueueOptions = { pipelining: { maxBatch: 50, maxWaitMs: 2 } };
     * ```
     */
    pipelining?: PipeliningOptions;

    /**
     * Token Bucket rate limiter configuration for this queue.
     * Throttles job processing atomically using Redis Lua token buckets.
     *
     * @example
     * ```ts
     * const opts: QueueOptions = {
     *     rateLimiter: { max: 100, duration: 1000, burst: 120 }
     * };
     * ```
     */
    rateLimiter?: RateLimiterOptions;

    /**
     * Convenience alias for `rateLimiter`.
     */
    limiter?: RateLimiterOptions;

    /**
     * Queue-wide default deduplication and idempotency configuration.
     * - `true`: Enables automatic SHA-256 payload content hashing with 60s window.
     * - `DeduplicationOptions`: Custom window duration, key ID, or collision strategy.
     *
     * @example
     * ```ts
     * const opts: QueueOptions = {
     *     deduplication: { ttl: 300_000, strategy: "ignore-if-exists" }
     * };
     * ```
     */
    deduplication?: boolean | DeduplicationOptions;

    /**
     * Disable if this queue does not need to receive job events.
     * Disabling events eliminates Pub/Sub listening overhead and event-loop listeners on this queue.
     *
     * @default true
     *
     * @example
     * ```ts
     * const opts: QueueOptions = { getEvents: false };
     * ```
     */
    getEvents?: boolean;

    /**
     * Disable if this worker does not need to send job events back to other queues.
     * Disabling events skips event emission when jobs progress, complete, or fail, maximizing processing speed.
     *
     * @default true
     *
     * @example
     * ```ts
     * const opts: QueueOptions = { sendEvents: false };
     * ```
     */
    sendEvents?: boolean;

    /**
     * Disable if this worker does not need to associate events with specific Job instances.
     * This normally improves memory usage, as the storage of jobs is unnecessary for many use-cases.
     *
     * @default true
     *
     * @example
     * ```ts
     * const opts: QueueOptions = { storeJobs: false };
     * ```
     */
    storeJobs?: boolean;

    /**
     * Enable to have this worker automatically remove its successfully completed jobs from Redis,
     * so as to keep memory usage down.
     *
     * @default false
     *
     * @example
     * ```ts
     * const opts: QueueOptions = { removeOnSuccess: true };
     * ```
     */
    removeOnSuccess?: boolean;

    /**
     * Enable to have this worker automatically remove its failed jobs from Redis,
     * so as to keep memory usage down. This will not remove jobs that are set to retry
     * unless they fail all their retries.
     *
     * @default false
     *
     * @example
     * ```ts
     * const opts: QueueOptions = { removeOnFailure: true };
     * ```
     */
    removeOnFailure?: boolean;
}

export type {
    DeduplicationOptions,
    PipeliningOptions,
} from "../../domain/repositories/queue.repository.js";
export type { RateLimiterOptions } from "./rate-limiter-options.dto.js";
