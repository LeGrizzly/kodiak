import type { Job } from "../../domain/entities/job.entity.js";

/**
 * Scoped, contextual logger bound to the specific queue and active job execution.
 *
 * Automatically prefixes log messages with `[Kodiak:<queueName>:<jobId>]`.
 *
 * @example
 * ```ts
 * context.logger.info("Processing order payload", { orderId: context.data.id });
 * context.logger.warn("Slow downstream API response detected");
 * context.logger.error("Failed to parse response", error);
 * ```
 */
export interface IJobLogger {
    /**
     * Logs an informational message tagged with the current job ID.
     */
    info(message: string, ...args: unknown[]): void;

    /**
     * Logs a warning message tagged with the current job ID.
     */
    warn(message: string, ...args: unknown[]): void;

    /**
     * Logs an error message tagged with the current job ID.
     */
    error(message: string, ...args: unknown[]): void;

    /**
     * Logs a debug diagnostic message tagged with the current job ID.
     */
    debug(message: string, ...args: unknown[]): void;
}

/**
 * Execution context supplied to worker processors during job execution.
 *
 * Provides direct access to the typed payload, contextual logger,
 * atomic progress reporting, and manual heartbeat lock extension.
 *
 * @template T Type of the job payload data.
 *
 * @example
 * ### Using JobContext in a Worker Processor
 * ```ts
 * interface VideoRenderPayload {
 *     videoId: string;
 *     resolution: "1080p" | "4K";
 * }
 *
 * const worker = kodiak.createWorker<VideoRenderPayload>(
 *     "video-rendering",
 *     async (context) => {
 *         context.logger.info(`Starting render for ${context.data.videoId}`);
 *
 *         // Report initial progress (0-100%)
 *         await context.updateProgress(10);
 *
 *         // Heavy rendering loop with manual heartbeats to prevent stalled detection
 *         for (let step = 1; step <= 5; step++) {
 *             await renderSegment(step);
 *             await context.heartbeat(); // Extend Redis lock
 *             await context.updateProgress(10 + step * 18);
 *         }
 *
 *         context.logger.info(`Completed video ${context.data.videoId}`);
 *     }
 * );
 * ```
 */
export interface JobContext<T> {
    /**
     * The underlying Job entity containing metadata (id, retryCount, timestamp, etc.).
     */
    job: Job<T>;

    /**
     * Strongly-typed user payload of the job.
     */
    data: T;

    /**
     * Contextual logger automatically prefixing log messages with `[Kodiak:<queue>:<jobId>]`.
     */
    logger: IJobLogger;

    /**
     * Atomically reports execution progress (0 to 100) to Redis and updates in-memory job state.
     *
     * @param progress Progress percentage between 0 and 100.
     */
    updateProgress: (progress: number) => Promise<void>;

    /**
     * Manually extends the job's lock in Redis, refreshing the lockDuration timeout.
     * Returns true if the lock was successfully refreshed, or false if the lock was lost.
     */
    heartbeat: () => Promise<boolean>;
}
