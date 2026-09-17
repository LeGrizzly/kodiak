import { EventEmitter } from "node:events";
import type { JobOptions } from "../application/dtos/job-options.dto.js";
import type { QueueOptions } from "../application/dtos/queue-options.dto.js";
import type { RateLimiterOptions } from "../application/dtos/rate-limiter-options.dto.js";
import { AddJobUseCase } from "../application/use-cases/add-job.use-case.js";
import { CleanFailedJobsUseCase } from "../application/use-cases/clean-failed-jobs.use-case.js";
import { ConsumeRateLimitUseCase } from "../application/use-cases/consume-rate-limit.use-case.js";
import { GetFailedCountUseCase } from "../application/use-cases/get-failed-count.use-case.js";
import { GetFailedJobsUseCase } from "../application/use-cases/get-failed-jobs.use-case.js";
import { GetRateLimitStatusUseCase } from "../application/use-cases/get-rate-limit-status.use-case.js";
import { RetryFailedJobUseCase } from "../application/use-cases/retry-failed-job.use-case.js";
import type { Job } from "../domain/entities/job.entity.js";
import type {
    IDLQRepository,
    IQueueRepository,
    IRateLimiterRepository,
    IRateLimitStatus,
} from "../domain/repositories/queue.repository.js";
import type { IJobSerializer } from "../domain/serializers/job-serializer.interface.js";
import {
    DragonflyQueueRepository,
    type PipeliningOptions,
} from "../infrastructure/dragonfly/dragonfly-queue.repository.js";
import type { Kodiak } from "./kodiak.js";

export class Queue<T> extends EventEmitter {
    private readonly addJobUseCase: AddJobUseCase<T>;
    private readonly getFailedCountUseCase: GetFailedCountUseCase<T>;
    private readonly getFailedJobsUseCase: GetFailedJobsUseCase<T>;
    private readonly retryFailedJobUseCase: RetryFailedJobUseCase<T>;
    private readonly cleanFailedJobsUseCase: CleanFailedJobsUseCase<T>;
    private readonly consumeRateLimitUseCase: ConsumeRateLimitUseCase;
    private readonly getRateLimitStatusUseCase: GetRateLimitStatusUseCase;
    private readonly queueRepository: IQueueRepository<T>;
    private schedulerInterval: NodeJS.Timeout | null = null;
    private recoveringStalledJobs = false;
    private readonly connection: { quit: () => Promise<unknown> };

    constructor(
        public readonly name: string,
        private readonly kodiak: Kodiak,
        repository?: IQueueRepository<T>,
        serializerOrOptions?: IJobSerializer | QueueOptions,
        pipelining?: PipeliningOptions,
        rateLimiter?: RateLimiterOptions,
    ) {
        super();

        let serializer: IJobSerializer | undefined;
        let pipeOpts: PipeliningOptions | undefined = pipelining;
        let limiterOpts: RateLimiterOptions | undefined = rateLimiter;

        if (
            serializerOrOptions &&
            typeof serializerOrOptions === "object" &&
            !("serialize" in serializerOrOptions)
        ) {
            serializer = serializerOrOptions.serializer;
            pipeOpts = serializerOrOptions.pipelining ?? pipeOpts;
            limiterOpts =
                serializerOrOptions.rateLimiter ?? serializerOrOptions.limiter ?? limiterOpts;
        } else if (serializerOrOptions && "serialize" in serializerOrOptions) {
            serializer = serializerOrOptions;
        }

        const conn = this.kodiak.connection.duplicate();
        this.connection = conn;
        this.queueRepository =
            repository ??
            new DragonflyQueueRepository<T>(
                name,
                conn,
                this.kodiak.prefix,
                serializer ?? this.kodiak.serializer,
                pipeOpts ?? this.kodiak.pipelining,
                limiterOpts,
            );

        this.addJobUseCase = new AddJobUseCase<T>(this.queueRepository);
        const dlqRepo = this.queueRepository as unknown as IDLQRepository<T>;
        this.getFailedCountUseCase = new GetFailedCountUseCase<T>(dlqRepo);
        this.getFailedJobsUseCase = new GetFailedJobsUseCase<T>(dlqRepo);
        this.retryFailedJobUseCase = new RetryFailedJobUseCase<T>(dlqRepo);
        this.cleanFailedJobsUseCase = new CleanFailedJobsUseCase<T>(dlqRepo);

        const rateLimitRepo = this.queueRepository as unknown as IRateLimiterRepository;
        this.consumeRateLimitUseCase = new ConsumeRateLimitUseCase(rateLimitRepo);
        this.getRateLimitStatusUseCase = new GetRateLimitStatusUseCase(rateLimitRepo);

        this.startScheduler();
    }

    public async add(id: string, data: T, options?: JobOptions): Promise<Job<T>> {
        return this.addJobUseCase.execute(id, data, options);
    }

    public async getFailedCount(): Promise<number> {
        return this.getFailedCountUseCase.execute();
    }

    public async getFailedJobs(start = 0, limit = 20): Promise<Job<T>[]> {
        return this.getFailedJobsUseCase.execute(start, limit);
    }

    public async retryJob(jobId: string): Promise<boolean> {
        return this.retryFailedJobUseCase.execute(jobId);
    }

    public async retryAllFailed(limit = 100): Promise<number> {
        return this.retryFailedJobUseCase.executeAll(limit);
    }

    public async cleanFailed(olderThanMs = 0): Promise<number> {
        return this.cleanFailedJobsUseCase.execute(olderThanMs);
    }

    public async consumeRateLimit(count = 1): Promise<boolean> {
        return this.consumeRateLimitUseCase.execute(count);
    }

    public async getRateLimitStatus(): Promise<IRateLimitStatus | null> {
        return this.getRateLimitStatusUseCase.execute();
    }

    public async close(): Promise<void> {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
        await this.connection.quit();
    }

    private startScheduler(): void {
        if (this.schedulerInterval) return;

        this.schedulerInterval = setInterval(async () => {
            await this.tickScheduler();
        }, 5000);
        if (this.schedulerInterval && typeof this.schedulerInterval.unref === "function") {
            this.schedulerInterval.unref();
        }
    }

    private async tickScheduler(): Promise<void> {
        try {
            await this.queueRepository.promoteDelayedJobs();
        } catch (error) {
            this.emit("error", error);
        }

        if (this.recoveringStalledJobs) return;
        this.recoveringStalledJobs = true;
        try {
            const recovered = await this.queueRepository.recoverStalledJobs();
            if (recovered && Array.isArray(recovered) && recovered.length > 0) {
                this.emit(
                    "info",
                    `[Queue:${this.name}] Recovered ${recovered.length} stalled job(s): ${recovered.join(", ")}`,
                );
            }
        } catch (error) {
            this.emit("error", error);
        } finally {
            this.recoveringStalledJobs = false;
        }
    }
}
