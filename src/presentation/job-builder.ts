import { JobOptionsBuilder } from "../application/dtos/job-options.builder.js";
import type {
    BackoffOptions,
    DeduplicationOptions,
    JobOptions,
    RepeatOptions,
} from "../application/dtos/job-options.dto.js";
import type { Job } from "../domain/entities/job.entity.js";

/**
 * Minimal queue target interface for JobBuilder execution.
 */
export interface IJobQueueTarget<T> {
    add(id: string, data: T, options?: JobOptions): Promise<Job<T>>;
}

/**
 * Fluent builder for creating and enqueuing an ad-hoc Job on a queue.
 */
export class JobBuilder<T> {
    private optionsBuilder: JobOptionsBuilder;

    constructor(
        private readonly id: string,
        private readonly data: T,
        private readonly queue: IJobQueueTarget<T>,
        initialOptions?: JobOptions | JobOptionsBuilder,
    ) {
        this.optionsBuilder = new JobOptionsBuilder(initialOptions);
    }

    public priority(priority: number): this {
        this.optionsBuilder = this.optionsBuilder.priority(priority);
        return this;
    }

    public delay(delayMs: number): this {
        this.optionsBuilder = this.optionsBuilder.delay(delayMs);
        return this;
    }

    public waitUntil(date: Date): this {
        this.optionsBuilder = this.optionsBuilder.waitUntil(date);
        return this;
    }

    public attempts(count: number): this {
        this.optionsBuilder = this.optionsBuilder.attempts(count);
        return this;
    }

    public backoff(type: "fixed" | "exponential", delay: number): this;
    public backoff(options: BackoffOptions): this;
    public backoff(typeOrOptions: "fixed" | "exponential" | BackoffOptions, delay?: number): this {
        this.optionsBuilder =
            typeof typeOrOptions === "string"
                ? this.optionsBuilder.backoff(typeOrOptions, delay ?? 0)
                : this.optionsBuilder.backoff(typeOrOptions);
        return this;
    }

    public repeat(every: number, limit?: number): this;
    public repeat(options: RepeatOptions): this;
    public repeat(everyOrOptions: number | RepeatOptions, limit?: number): this {
        this.optionsBuilder =
            typeof everyOrOptions === "number"
                ? this.optionsBuilder.repeat(everyOrOptions, limit)
                : this.optionsBuilder.repeat(everyOrOptions);
        return this;
    }

    public deduplication(options: boolean | DeduplicationOptions): this {
        this.optionsBuilder = this.optionsBuilder.deduplication(options);
        return this;
    }

    public deduplicate(options: boolean | DeduplicationOptions = true): this {
        this.optionsBuilder = this.optionsBuilder.deduplicate(options);
        return this;
    }

    public traceparent(traceparent: string): this {
        this.optionsBuilder = this.optionsBuilder.traceparent(traceparent);
        return this;
    }

    public removeOnSuccess(remove = true): this {
        this.optionsBuilder = this.optionsBuilder.removeOnSuccess(remove);
        return this;
    }

    public removeOnFailure(remove = true): this {
        this.optionsBuilder = this.optionsBuilder.removeOnFailure(remove);
        return this;
    }

    public options(options: Partial<JobOptions> | JobOptionsBuilder): this {
        this.optionsBuilder = this.optionsBuilder.options(options);
        return this;
    }

    public async add(): Promise<Job<T>> {
        return this.queue.add(this.id, this.data, this.optionsBuilder.build());
    }
}
