import type {
    DeduplicationOptions,
    PipeliningOptions,
} from "../../domain/repositories/queue.repository.js";
import type { IJobSerializer } from "../../domain/serializers/job-serializer.interface.js";
import type { QueueOptions, RateLimiterOptions } from "./queue-options.dto.js";

/**
 * Resolves a QueueOptions object or QueueOptionsBuilder to a raw QueueOptions object.
 */
export function resolveQueueOptions(
    options?: QueueOptions | QueueOptionsBuilder,
): QueueOptions | undefined {
    if (!options) return undefined;
    if ("build" in options && typeof options.build === "function") {
        return options.build();
    }
    return options as QueueOptions;
}

/**
 * Fluent builder for creating and configuring QueueOptions immutably.
 */
export class QueueOptionsBuilder {
    private readonly opts: QueueOptions;

    constructor(initial?: QueueOptions | QueueOptionsBuilder) {
        this.opts = initial ? { ...resolveQueueOptions(initial) } : {};
    }

    public serializer(serializer: IJobSerializer): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, serializer });
    }

    public pipelining(pipelining: PipeliningOptions): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, pipelining });
    }

    public rateLimiter(rateLimiter: RateLimiterOptions): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, rateLimiter });
    }

    public limiter(limiter: RateLimiterOptions): QueueOptionsBuilder {
        return this.rateLimiter(limiter);
    }

    public deduplication(options: boolean | DeduplicationOptions): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, deduplication: options });
    }

    public deduplicate(options: boolean | DeduplicationOptions = true): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, deduplication: options });
    }

    public getEvents(enabled = true): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, getEvents: enabled });
    }

    public sendEvents(enabled = true): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, sendEvents: enabled });
    }

    public storeJobs(enabled = true): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, storeJobs: enabled });
    }

    /**
     * Preset for maximum throughput: disables pub/sub event emission and job instances storage.
     */
    public disableEvents(): QueueOptionsBuilder {
        return new QueueOptionsBuilder({
            ...this.opts,
            getEvents: false,
            sendEvents: false,
            storeJobs: false,
        });
    }

    public removeOnSuccess(remove = true): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, removeOnSuccess: remove });
    }

    public removeOnFailure(remove = true): QueueOptionsBuilder {
        return new QueueOptionsBuilder({ ...this.opts, removeOnFailure: remove });
    }

    public options(options: Partial<QueueOptions> | QueueOptionsBuilder): QueueOptionsBuilder {
        const resolved =
            "build" in options && typeof options.build === "function" ? options.build() : options;
        return new QueueOptionsBuilder({ ...this.opts, ...resolved });
    }

    public build(): QueueOptions {
        return { ...this.opts };
    }
}

/**
 * Creates a new QueueOptionsBuilder instance.
 */
export function queueOptions(initial?: QueueOptions | QueueOptionsBuilder): QueueOptionsBuilder {
    return new QueueOptionsBuilder(initial);
}
