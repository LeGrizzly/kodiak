import type { IJobSerializer } from "../../domain/serializers/job-serializer.interface.js";
import type { BackoffStrategy } from "../../domain/strategies/backoff.strategy.js";
import type { RateLimiterOptions } from "./rate-limiter-options.dto.js";
import type {
    AdaptivePrefetchOptions,
    WorkerAckPipeliningOptions,
    WorkerOptions,
} from "./worker-options.dto.js";

/**
 * Resolves a WorkerOptions object or WorkerOptionsBuilder to a raw WorkerOptions object.
 */
export function resolveWorkerOptions(
    options?: WorkerOptions | WorkerOptionsBuilder,
): WorkerOptions | undefined {
    if (!options) return undefined;
    if ("build" in options && typeof options.build === "function") {
        return options.build();
    }
    return options as WorkerOptions;
}

/**
 * Fluent builder for creating and configuring WorkerOptions immutably.
 */
export class WorkerOptionsBuilder {
    private readonly opts: WorkerOptions;

    constructor(initial?: WorkerOptions | WorkerOptionsBuilder) {
        this.opts = initial ? { ...resolveWorkerOptions(initial) } : {};
    }

    public concurrency(concurrency: number): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, concurrency });
    }

    public prefetch(prefetch: number | "auto" | AdaptivePrefetchOptions): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, prefetch });
    }

    public ackPipelining(
        ackPipelining: boolean | WorkerAckPipeliningOptions,
    ): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, ackPipelining });
    }

    public lockDuration(lockDuration: number): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, lockDuration });
    }

    public gracefulShutdownTimeout(timeout: number): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({
            ...this.opts,
            gracefulShutdownTimeout: timeout,
        });
    }

    public gracefulShutdown(timeout: number): WorkerOptionsBuilder {
        return this.gracefulShutdownTimeout(timeout);
    }

    public heartbeat(enabled: boolean, intervalMs?: number): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({
            ...this.opts,
            heartbeatEnabled: enabled,
            heartbeatInterval: intervalMs,
        });
    }

    public heartbeatEnabled(enabled: boolean): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, heartbeatEnabled: enabled });
    }

    public heartbeatInterval(intervalMs: number): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, heartbeatInterval: intervalMs });
    }

    public backoffStrategy(name: string, strategy: BackoffStrategy): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({
            ...this.opts,
            backoffStrategies: {
                ...this.opts.backoffStrategies,
                [name]: strategy,
            },
        });
    }

    public backoffStrategies(strategies: Record<string, BackoffStrategy>): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({
            ...this.opts,
            backoffStrategies: {
                ...this.opts.backoffStrategies,
                ...strategies,
            },
        });
    }

    public serializer(serializer: IJobSerializer): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, serializer });
    }

    public telemetry(telemetry = true): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, telemetry });
    }

    public credits(
        credits: number | { maxCredits: number; replenishBatchThreshold?: number },
    ): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, credits });
    }

    public rateLimiter(rateLimiter: RateLimiterOptions): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, rateLimiter });
    }

    public limiter(limiter: RateLimiterOptions): WorkerOptionsBuilder {
        return this.rateLimiter(limiter);
    }

    public sendEvents(enabled = true): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, sendEvents: enabled });
    }

    public storeJobs(enabled = true): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, storeJobs: enabled });
    }

    public removeOnSuccess(remove = true): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, removeOnSuccess: remove });
    }

    public removeOnFailure(remove = true): WorkerOptionsBuilder {
        return new WorkerOptionsBuilder({ ...this.opts, removeOnFailure: remove });
    }

    public options(options: Partial<WorkerOptions> | WorkerOptionsBuilder): WorkerOptionsBuilder {
        const resolved =
            "build" in options && typeof options.build === "function" ? options.build() : options;
        return new WorkerOptionsBuilder({ ...this.opts, ...resolved });
    }

    public build(): WorkerOptions {
        return { ...this.opts };
    }
}

/**
 * Creates a new WorkerOptionsBuilder instance.
 */
export function workerOptions(
    initial?: WorkerOptions | WorkerOptionsBuilder,
): WorkerOptionsBuilder {
    return new WorkerOptionsBuilder(initial);
}
