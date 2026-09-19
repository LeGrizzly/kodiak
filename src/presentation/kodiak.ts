import { randomUUID } from "node:crypto";
import type { Redis, RedisOptions } from "ioredis";
import type { JobOptions } from "../application/dtos/job-options.dto.js";
import type { QueueOptions } from "../application/dtos/queue-options.dto.js";
import type { WorkerOptions } from "../application/dtos/worker-options.dto.js";
import type { Job } from "../domain/entities/job.entity.js";
import type { IJobSerializer } from "../domain/serializers/job-serializer.interface.js";
import { DragonflyConnection } from "../infrastructure/dragonfly/dragonfly-connection.js";
import type { PipeliningOptions } from "../infrastructure/dragonfly/dragonfly-queue.repository.js";
import { MsgpackJobSerializer } from "../infrastructure/serializers/msgpack-job.serializer.js";
import { Queue } from "./queue.js";
import type { TaskDefinition } from "./task.js";
import { Worker, type WorkerProcessor } from "./worker.js";

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

    public createQueue<T>(name: string, options?: QueueOptions): Queue<T> {
        if (options) {
            this.queueConfigs.set(name, options);
        }
        if (options && options.deduplication !== undefined) {
            return new Queue<T>(name, this, undefined, options);
        }
        const limiter = options?.rateLimiter ?? options?.limiter;
        if (limiter !== undefined) {
            return new Queue<T>(
                name,
                this,
                undefined,
                options?.serializer ?? this.serializer,
                options?.pipelining ?? this.pipelining,
                limiter,
            );
        }
        return new Queue<T>(
            name,
            this,
            undefined,
            options?.serializer ?? this.serializer,
            options?.pipelining ?? this.pipelining,
        );
    }

    public createWorker<T>(
        name: string,
        processor: WorkerProcessor<T>,
        opts?: WorkerOptions,
    ): Worker<T> {
        const queueConfig = this.queueConfigs.get(name);
        const inheritedLimiter = queueConfig?.rateLimiter ?? queueConfig?.limiter;
        const mergedOpts: WorkerOptions = {
            ...opts,
            rateLimiter: opts?.rateLimiter ?? opts?.limiter ?? inheritedLimiter,
        };
        return new Worker<T>(name, processor, this, mergedOpts);
    }

    public async push<T>(
        taskDef: TaskDefinition<T>,
        data: T,
        options?: JobOptions,
    ): Promise<Job<T>> {
        const queue = this.createQueue<T>(taskDef.name);
        const resolvedData =
            typeof taskDef.schema === "function"
                ? taskDef.schema(data)
                : taskDef.schema && typeof taskDef.schema.parse === "function"
                  ? taskDef.schema.parse(data)
                  : data;

        const mergedOptions: JobOptions = { ...taskDef.options, ...options };
        return queue.add(randomUUID(), resolvedData, mergedOptions);
    }

    public worker<T>(
        taskDef: TaskDefinition<T>,
        processor: WorkerProcessor<T>,
        opts?: WorkerOptions,
    ): Worker<T> {
        const mergedOpts: WorkerOptions = {
            ...opts,
        };
        return this.createWorker<T>(taskDef.name, processor, mergedOpts);
    }

    public async close(): Promise<void> {
        await this.dragonflyConnection.quit();
    }
}
