import type {
    BackoffOptions,
    DeduplicationOptions,
    JobOptions,
    RepeatOptions,
} from "./job-options.dto.js";

/**
 * Resolves a JobOptions object or JobOptionsBuilder to a raw JobOptions object.
 */
export function resolveJobOptions(
    options?: JobOptions | JobOptionsBuilder,
): JobOptions | undefined {
    if (!options) return undefined;
    if ("build" in options && typeof options.build === "function") {
        return options.build();
    }
    return options as JobOptions;
}

/**
 * Fluent builder for creating and configuring JobOptions immutably.
 */
export class JobOptionsBuilder {
    private readonly opts: JobOptions;

    constructor(initial?: JobOptions | JobOptionsBuilder) {
        this.opts = initial ? { ...resolveJobOptions(initial) } : {};
    }

    public priority(priority: number): JobOptionsBuilder {
        return new JobOptionsBuilder({ ...this.opts, priority });
    }

    public delay(delayMs: number): JobOptionsBuilder {
        return new JobOptionsBuilder({ ...this.opts, delay: delayMs });
    }

    public waitUntil(date: Date): JobOptionsBuilder {
        return new JobOptionsBuilder({ ...this.opts, waitUntil: date });
    }

    public attempts(count: number): JobOptionsBuilder {
        return new JobOptionsBuilder({ ...this.opts, attempts: count });
    }

    public backoff(type: "fixed" | "exponential", delay: number): JobOptionsBuilder;
    public backoff(options: BackoffOptions): JobOptionsBuilder;
    public backoff(
        typeOrOptions: "fixed" | "exponential" | BackoffOptions,
        delay?: number,
    ): JobOptionsBuilder {
        const backoffConfig: BackoffOptions =
            typeof typeOrOptions === "string"
                ? { type: typeOrOptions, delay: delay ?? 0 }
                : typeOrOptions;

        return new JobOptionsBuilder({ ...this.opts, backoff: backoffConfig });
    }

    public repeat(every: number, limit?: number): JobOptionsBuilder;
    public repeat(options: RepeatOptions): JobOptionsBuilder;
    public repeat(everyOrOptions: number | RepeatOptions, limit?: number): JobOptionsBuilder {
        const repeatConfig: RepeatOptions =
            typeof everyOrOptions === "number"
                ? { every: everyOrOptions, ...(limit !== undefined ? { limit } : {}) }
                : everyOrOptions;

        return new JobOptionsBuilder({ ...this.opts, repeat: repeatConfig });
    }

    public deduplication(options: boolean | DeduplicationOptions): JobOptionsBuilder {
        return new JobOptionsBuilder({ ...this.opts, deduplication: options });
    }

    public deduplicate(options: boolean | DeduplicationOptions = true): JobOptionsBuilder {
        return new JobOptionsBuilder({ ...this.opts, deduplication: options });
    }

    public traceparent(traceparent: string): JobOptionsBuilder {
        return new JobOptionsBuilder({ ...this.opts, traceparent });
    }

    public removeOnSuccess(remove = true): JobOptionsBuilder {
        return new JobOptionsBuilder({ ...this.opts, removeOnSuccess: remove });
    }

    public removeOnFailure(remove = true): JobOptionsBuilder {
        return new JobOptionsBuilder({ ...this.opts, removeOnFailure: remove });
    }

    public options(options: Partial<JobOptions> | JobOptionsBuilder): JobOptionsBuilder {
        const resolved =
            "build" in options && typeof options.build === "function" ? options.build() : options;
        return new JobOptionsBuilder({ ...this.opts, ...resolved });
    }

    public build(): JobOptions {
        return { ...this.opts };
    }
}

/**
 * Creates a new JobOptionsBuilder instance.
 */
export function jobOptions(initial?: JobOptions | JobOptionsBuilder): JobOptionsBuilder {
    return new JobOptionsBuilder(initial);
}
