import { JobOptionsBuilder } from "../application/dtos/job-options.builder.js";
import type {
    BackoffOptions,
    DeduplicationOptions,
    JobOptions,
    RepeatOptions,
} from "../application/dtos/job-options.dto.js";

/**
 * Task payload validation schema.
 */
export type TaskSchema<T> = { parse: (input: unknown) => T } | ((input: unknown) => T);

/**
 * Task declaration configuration.
 * Note: execution options (attempts, backoff, priority, etc.) must be configured
 * via the fluent TaskBuilder chaining methods.
 */
export interface TaskConfig<T> {
    name: string;
    schema?: TaskSchema<T>;
}

/**
 * Task contract representation.
 */
export interface TaskDefinition<T> {
    name: string;
    options?: JobOptions;
    schema?: TaskSchema<T>;
}

/**
 * Fluent builder for declaring and configuring strongly-typed Kodiak tasks.
 */
export class TaskBuilder<T> implements TaskDefinition<T> {
    public readonly name: string;
    public readonly options?: JobOptions;
    public readonly schema?: TaskSchema<T>;

    constructor(name: string, options?: JobOptions, schema?: TaskSchema<T>) {
        this.name = name;
        this.options = options;
        this.schema = schema;
    }

    private cloneWithOptions(newOptions: JobOptions): TaskBuilder<T> {
        return new TaskBuilder<T>(this.name, newOptions, this.schema);
    }

    public priority(priority: number): TaskBuilder<T> {
        return this.cloneWithOptions(
            new JobOptionsBuilder(this.options).priority(priority).build(),
        );
    }

    public delay(delayMs: number): TaskBuilder<T> {
        return this.cloneWithOptions(new JobOptionsBuilder(this.options).delay(delayMs).build());
    }

    public waitUntil(date: Date): TaskBuilder<T> {
        return this.cloneWithOptions(new JobOptionsBuilder(this.options).waitUntil(date).build());
    }

    public attempts(count: number): TaskBuilder<T> {
        return this.cloneWithOptions(new JobOptionsBuilder(this.options).attempts(count).build());
    }

    public backoff(type: "fixed" | "exponential", delay: number): TaskBuilder<T>;
    public backoff(options: BackoffOptions): TaskBuilder<T>;
    public backoff(
        typeOrOptions: "fixed" | "exponential" | BackoffOptions,
        delay?: number,
    ): TaskBuilder<T> {
        const builder = new JobOptionsBuilder(this.options);
        const backoffConfig =
            typeof typeOrOptions === "string"
                ? builder.backoff(typeOrOptions, delay ?? 0).build()
                : builder.backoff(typeOrOptions).build();

        return this.cloneWithOptions(backoffConfig);
    }

    public repeat(every: number, limit?: number): TaskBuilder<T>;
    public repeat(options: RepeatOptions): TaskBuilder<T>;
    public repeat(everyOrOptions: number | RepeatOptions, limit?: number): TaskBuilder<T> {
        const builder = new JobOptionsBuilder(this.options);
        const repeatConfig =
            typeof everyOrOptions === "number"
                ? builder.repeat(everyOrOptions, limit).build()
                : builder.repeat(everyOrOptions).build();

        return this.cloneWithOptions(repeatConfig);
    }

    public deduplication(options: boolean | DeduplicationOptions): TaskBuilder<T> {
        return this.cloneWithOptions(
            new JobOptionsBuilder(this.options).deduplication(options).build(),
        );
    }

    public deduplicate(options: boolean | DeduplicationOptions = true): TaskBuilder<T> {
        return this.cloneWithOptions(
            new JobOptionsBuilder(this.options).deduplicate(options).build(),
        );
    }

    public traceparent(traceparent: string): TaskBuilder<T> {
        return this.cloneWithOptions(
            new JobOptionsBuilder(this.options).traceparent(traceparent).build(),
        );
    }

    public removeOnSuccess(remove = true): TaskBuilder<T> {
        return this.cloneWithOptions(
            new JobOptionsBuilder(this.options).removeOnSuccess(remove).build(),
        );
    }

    public removeOnFailure(remove = true): TaskBuilder<T> {
        return this.cloneWithOptions(
            new JobOptionsBuilder(this.options).removeOnFailure(remove).build(),
        );
    }

    public withOptions(options: Partial<JobOptions> | JobOptionsBuilder): TaskBuilder<T> {
        const resolved =
            "build" in options && typeof options.build === "function" ? options.build() : options;

        return this.cloneWithOptions(new JobOptionsBuilder(this.options).options(resolved).build());
    }

    public withSchema<NewT = T>(schema: TaskSchema<NewT>): TaskBuilder<NewT> {
        return new TaskBuilder<NewT>(this.name, this.options, schema);
    }

    public validate<NewT = T>(schema: TaskSchema<NewT>): TaskBuilder<NewT> {
        return this.withSchema(schema);
    }

    public build(): TaskDefinition<T> {
        return {
            name: this.name,
            ...(this.options ? { options: { ...this.options } } : {}),
            ...(this.schema ? { schema: this.schema } : {}),
        };
    }

    public toDefinition(): TaskDefinition<T> {
        return this.build();
    }
}

/**
 * Declares a typed Kodiak task with fluent parameter builder methods.
 * Execution parameters (attempts, backoff, priority, etc.) must be chained via the returned TaskBuilder.
 */
export function task<T>(name: string): TaskBuilder<T>;
export function task<T>(config: TaskConfig<T>): TaskBuilder<T>;
export function task<T>(nameOrConfig: string | TaskConfig<T>): TaskBuilder<T> {
    if (typeof nameOrConfig === "string") {
        return new TaskBuilder<T>(nameOrConfig);
    }

    return new TaskBuilder<T>(nameOrConfig.name, undefined, nameOrConfig.schema);
}
