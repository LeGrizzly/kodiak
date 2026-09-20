import { WorkerOptionsBuilder } from "../application/dtos/worker-options.builder.js";
import type {
    AdaptivePrefetchOptions,
    WorkerAckPipeliningOptions,
    WorkerOptions,
} from "../application/dtos/worker-options.dto.js";
import type { IJobSerializer } from "../domain/serializers/job-serializer.interface.js";
import type { BackoffStrategy } from "../domain/strategies/backoff.strategy.js";
import type { Kodiak } from "./kodiak.js";
import type { Worker, WorkerProcessor } from "./worker.js";

/**
 * Fluent builder for creating, configuring, and starting a Kodiak Worker.
 */
export class WorkerBuilder<T> {
    private processor?: WorkerProcessor<T>;
    private optionsBuilder: WorkerOptionsBuilder;

    constructor(
        private readonly name: string,
        private readonly kodiak: Kodiak,
        initialOptions?: WorkerOptions | WorkerOptionsBuilder,
    ) {
        this.optionsBuilder = new WorkerOptionsBuilder(initialOptions);
    }

    public handler(processor: WorkerProcessor<T>): this {
        this.processor = processor;
        return this;
    }

    public process(processor: WorkerProcessor<T>): this {
        return this.handler(processor);
    }

    public concurrency(concurrency: number): this {
        this.optionsBuilder = this.optionsBuilder.concurrency(concurrency);
        return this;
    }

    public prefetch(prefetch: number | "auto" | AdaptivePrefetchOptions): this {
        this.optionsBuilder = this.optionsBuilder.prefetch(prefetch);
        return this;
    }

    public ackPipelining(ackPipelining: boolean | WorkerAckPipeliningOptions): this {
        this.optionsBuilder = this.optionsBuilder.ackPipelining(ackPipelining);
        return this;
    }

    public lockDuration(lockDuration: number): this {
        this.optionsBuilder = this.optionsBuilder.lockDuration(lockDuration);
        return this;
    }

    public gracefulShutdownTimeout(timeout: number): this {
        this.optionsBuilder = this.optionsBuilder.gracefulShutdownTimeout(timeout);
        return this;
    }

    public gracefulShutdown(timeout: number): this {
        return this.gracefulShutdownTimeout(timeout);
    }

    public heartbeat(enabled: boolean, intervalMs?: number): this {
        this.optionsBuilder = this.optionsBuilder.heartbeat(enabled, intervalMs);
        return this;
    }

    public heartbeatEnabled(enabled: boolean): this {
        this.optionsBuilder = this.optionsBuilder.heartbeatEnabled(enabled);
        return this;
    }

    public heartbeatInterval(intervalMs: number): this {
        this.optionsBuilder = this.optionsBuilder.heartbeatInterval(intervalMs);
        return this;
    }

    public backoffStrategy(name: string, strategy: BackoffStrategy): this {
        this.optionsBuilder = this.optionsBuilder.backoffStrategy(name, strategy);
        return this;
    }

    public backoffStrategies(strategies: Record<string, BackoffStrategy>): this {
        this.optionsBuilder = this.optionsBuilder.backoffStrategies(strategies);
        return this;
    }

    public serializer(serializer: IJobSerializer): this {
        this.optionsBuilder = this.optionsBuilder.serializer(serializer);
        return this;
    }

    public telemetry(telemetry = true): this {
        this.optionsBuilder = this.optionsBuilder.telemetry(telemetry);
        return this;
    }

    public credits(
        credits: number | { maxCredits: number; replenishBatchThreshold?: number },
    ): this {
        this.optionsBuilder = this.optionsBuilder.credits(credits);
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

    public removeOnSuccess(remove = true): this {
        this.optionsBuilder = this.optionsBuilder.removeOnSuccess(remove);
        return this;
    }

    public removeOnFailure(remove = true): this {
        this.optionsBuilder = this.optionsBuilder.removeOnFailure(remove);
        return this;
    }

    public options(options: Partial<WorkerOptions> | WorkerOptionsBuilder): this {
        this.optionsBuilder = this.optionsBuilder.options(options);
        return this;
    }

    public create(): Worker<T> {
        if (!this.processor) {
            throw new Error(
                `Worker for queue "${this.name}" requires a processor function. Call .handler(fn) or .process(fn) before creating.`,
            );
        }

        return this.kodiak.createWorker<T>(this.name, this.processor, this.optionsBuilder.build());
    }

    public build(): Worker<T> {
        return this.create();
    }

    public async start(): Promise<Worker<T>> {
        const worker = this.create();
        await worker.start();
        return worker;
    }
}
