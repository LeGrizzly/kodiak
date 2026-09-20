import { randomUUID } from "node:crypto";
import type { Redis, RedisOptions } from "ioredis";
import {
    type JobOptionsBuilder,
    resolveJobOptions,
} from "../application/dtos/job-options.builder.js";
import type { JobOptions } from "../application/dtos/job-options.dto.js";
import {
    type QueueOptionsBuilder,
    resolveQueueOptions,
} from "../application/dtos/queue-options.builder.js";
import type { QueueOptions } from "../application/dtos/queue-options.dto.js";
import {
    resolveWorkerOptions,
    type WorkerOptionsBuilder,
} from "../application/dtos/worker-options.builder.js";
import type { WorkerOptions } from "../application/dtos/worker-options.dto.js";
import type { Job } from "../domain/entities/job.entity.js";
import type { IJobSerializer } from "../domain/serializers/job-serializer.interface.js";
import { DragonflyConnection } from "../infrastructure/dragonfly/dragonfly-connection.js";
import type { PipeliningOptions } from "../infrastructure/dragonfly/dragonfly-queue.repository.js";
import { MsgpackJobSerializer } from "../infrastructure/serializers/msgpack-job.serializer.js";
import { Queue } from "./queue.js";
import { QueueBuilder } from "./queue-builder.js";
import type { TaskDefinition } from "./task.js";
import { Worker, type WorkerProcessor } from "./worker.js";
import { WorkerBuilder } from "./worker-builder.js";

export interface KodiakOptions {
    connection: RedisOptions;
    prefix?: string;
    pipelining?: PipeliningOptions;
    serializer?: IJobSerializer;
}

export class Kodiak {
    private readonly dragonflyConnection: DragonflyConnection;
    private readonly queueConfigs = new Map<string, QueueOptions>();
    public readonly connection: Redis;
    public readonly prefix: string;
    public readonly pipelining?: PipeliningOptions;
    public readonly serializer: IJobSerializer;

    constructor(private options: KodiakOptions) {
        this.dragonflyConnection = new DragonflyConnection(this.options.connection);
        this.connection = this.dragonflyConnection.getRawClient();
        this.prefix = this.options.prefix ?? "kodiak";
        this.pipelining = this.options.pipelining;
        this.serializer = this.options.serializer ?? new MsgpackJobSerializer();
    }

    public createQueue<T>(name: string, options?: QueueOptions | QueueOptionsBuilder): Queue<T> {
        const resolvedOptions = resolveQueueOptions(options);

        if (resolvedOptions) {
            this.queueConfigs.set(name, resolvedOptions);
        }
        const hasExtendedOptions =
            resolvedOptions &&
            (resolvedOptions.deduplication !== undefined ||
                resolvedOptions.getEvents !== undefined ||
                resolvedOptions.sendEvents !== undefined ||
                resolvedOptions.storeJobs !== undefined ||
                resolvedOptions.removeOnSuccess !== undefined ||
                resolvedOptions.removeOnFailure !== undefined);

        if (hasExtendedOptions) {
            return new Queue<T>(name, this, undefined, resolvedOptions);
        }
        const limiter = resolvedOptions?.rateLimiter ?? resolvedOptions?.limiter;
        if (limiter !== undefined) {
            return new Queue<T>(
                name,
                this,
                undefined,
                resolvedOptions?.serializer ?? this.serializer,
                resolvedOptions?.pipelining ?? this.pipelining,
                limiter,
            );
        }
        return new Queue<T>(
            name,
            this,
            undefined,
            resolvedOptions?.serializer ?? this.serializer,
            resolvedOptions?.pipelining ?? this.pipelining,
        );
    }

    public queueBuilder<T>(
        name: string,
        initialOptions?: QueueOptions | QueueOptionsBuilder,
    ): QueueBuilder<T> {
        return new QueueBuilder<T>(name, this, initialOptions);
    }

    public createWorker<T>(
        name: string,
        processor: WorkerProcessor<T>,
        opts?: WorkerOptions | WorkerOptionsBuilder,
    ): Worker<T> {
        const resolvedOpts = resolveWorkerOptions(opts);

        const queueConfig = this.queueConfigs.get(name);
        const inheritedLimiter = queueConfig?.rateLimiter ?? queueConfig?.limiter;
        const mergedOpts: WorkerOptions = {
            ...resolvedOpts,
            rateLimiter: resolvedOpts?.rateLimiter ?? resolvedOpts?.limiter ?? inheritedLimiter,
            sendEvents: resolvedOpts?.sendEvents ?? queueConfig?.sendEvents,
            storeJobs: resolvedOpts?.storeJobs ?? queueConfig?.storeJobs,
            removeOnSuccess: resolvedOpts?.removeOnSuccess ?? queueConfig?.removeOnSuccess,
            removeOnFailure: resolvedOpts?.removeOnFailure ?? queueConfig?.removeOnFailure,
        };
        return new Worker<T>(name, processor, this, mergedOpts);
    }

    public workerBuilder<T>(
        name: string,
        initialOptions?: WorkerOptions | WorkerOptionsBuilder,
    ): WorkerBuilder<T> {
        return new WorkerBuilder<T>(name, this, initialOptions);
    }

    public async push<T>(
        taskDef: TaskDefinition<T>,
        data: T,
        options?: JobOptions | JobOptionsBuilder,
    ): Promise<Job<T>> {
        const resolvedOptions = resolveJobOptions(options);

        const queue = this.createQueue<T>(taskDef.name);
        const resolvedData =
            typeof taskDef.schema === "function"
                ? taskDef.schema(data)
                : taskDef.schema && typeof taskDef.schema.parse === "function"
                  ? taskDef.schema.parse(data)
                  : data;

        const mergedOptions: JobOptions = { ...taskDef.options, ...resolvedOptions };
        return queue.add(randomUUID(), resolvedData, mergedOptions);
    }

    public worker<T>(
        taskDef: TaskDefinition<T>,
        processor: WorkerProcessor<T>,
        opts?: WorkerOptions | WorkerOptionsBuilder,
    ): Worker<T> {
        const resolvedOpts = resolveWorkerOptions(opts);

        const mergedOpts: WorkerOptions = {
            ...resolvedOpts,
        };
        return this.createWorker<T>(taskDef.name, processor, mergedOpts);
    }

    public async close(): Promise<void> {
        await this.dragonflyConnection.quit();
    }
}
