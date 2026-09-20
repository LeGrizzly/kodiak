import { QueueOptionsBuilder } from "../application/dtos/queue-options.builder.js";
import type {
    DeduplicationOptions,
    PipeliningOptions,
    QueueOptions,
    RateLimiterOptions,
} from "../application/dtos/queue-options.dto.js";
import type { IJobSerializer } from "../domain/serializers/job-serializer.interface.js";
import type { Kodiak } from "./kodiak.js";
import type { Queue } from "./queue.js";

/**
 * Fluent builder for creating and configuring a Kodiak Queue.
 */
export class QueueBuilder<T> {
    private optionsBuilder: QueueOptionsBuilder;

    constructor(
        private readonly name: string,
        private readonly kodiak: Kodiak,
        initialOptions?: QueueOptions | QueueOptionsBuilder,
    ) {
        this.optionsBuilder = new QueueOptionsBuilder(initialOptions);
    }

    public serializer(serializer: IJobSerializer): this {
        this.optionsBuilder = this.optionsBuilder.serializer(serializer);
        return this;
    }

    public pipelining(pipelining: PipeliningOptions): this {
        this.optionsBuilder = this.optionsBuilder.pipelining(pipelining);
        return this;
    }

    public rateLimiter(rateLimiter: RateLimiterOptions): this {
        this.optionsBuilder = this.optionsBuilder.rateLimiter(rateLimiter);
        return this;
    }

    public limiter(limiter: RateLimiterOptions): this {
        return this.rateLimiter(limiter);
    }

    public deduplication(options: boolean | DeduplicationOptions): this {
        this.optionsBuilder = this.optionsBuilder.deduplication(options);
        return this;
    }

    public deduplicate(options: boolean | DeduplicationOptions = true): this {
        this.optionsBuilder = this.optionsBuilder.deduplicate(options);
        return this;
    }

    public getEvents(enabled = true): this {
        this.optionsBuilder = this.optionsBuilder.getEvents(enabled);
        return this;
    }

    public sendEvents(enabled = true): this {
        this.optionsBuilder = this.optionsBuilder.sendEvents(enabled);
        return this;
    }

    public storeJobs(enabled = true): this {
        this.optionsBuilder = this.optionsBuilder.storeJobs(enabled);
        return this;
    }

    public disableEvents(): this {
        this.optionsBuilder = this.optionsBuilder.disableEvents();
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

    public options(options: Partial<QueueOptions> | QueueOptionsBuilder): this {
        this.optionsBuilder = this.optionsBuilder.options(options);
        return this;
    }

    public create(): Queue<T> {
        return this.kodiak.createQueue<T>(this.name, this.optionsBuilder.build());
    }

    public build(): Queue<T> {
        return this.create();
    }
}
