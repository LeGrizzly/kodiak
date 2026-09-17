import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { setTimeout } from "node:timers/promises";
import type { JobContext } from "../application/dtos/job-context.dto.js";
import { JobContextPool } from "../application/dtos/job-context-pool.js";
import type { WorkerOptions } from "../application/dtos/worker-options.dto.js";
import { CreditFlowController } from "../application/flow-control/credit-flow-controller.js";
import { CompleteJobUseCase } from "../application/use-cases/complete-job.use-case.js";
import { FailJobUseCase } from "../application/use-cases/fail-job.use-case.js";
import { FetchJobsUseCase } from "../application/use-cases/fetch-jobs.use-case.js";
import { ReleaseJobsUseCase } from "../application/use-cases/release-jobs.use-case.js";
import { UpdateJobProgressUseCase } from "../application/use-cases/update-job-progress.use-case.js";
import type { Job } from "../domain/entities/job.entity.js";
import type { IQueueRepository } from "../domain/repositories/queue.repository.js";
import { DragonflyQueueRepository } from "../infrastructure/dragonfly/dragonfly-queue.repository.js";
import { Semaphore } from "../utils/semaphore.js";
import { AdaptivePrefetchManager } from "./adaptive-prefetch.js";
import type { Kodiak } from "./kodiak.js";
import { WorkerAckBuffer } from "./worker-ack-buffer.js";
import { WorkerHeartbeatManager } from "./worker-heartbeat.js";

export type WorkerProcessor<T> = (context: JobContext<T> & Job<T>) => Promise<void>;

export interface WorkerTelemetry {
    fetchCount: number;
    fetchDurationMs: number;
    processCount: number;
    processDurationMs: number;
    ackCount: number;
    ackDurationMs: number;
    idleDurationMs: number;
}

export class Worker<T> extends EventEmitter {
    private readonly fetchJobsUseCase: FetchJobsUseCase<T>;
    private readonly completeJobUseCase: CompleteJobUseCase<T>;
    private readonly failJobUseCase: FailJobUseCase<T>;
    private readonly updateJobProgressUseCase: UpdateJobProgressUseCase<T>;
    private readonly releaseJobsUseCase: ReleaseJobsUseCase<T>;
    private readonly ackQueueRepository: IQueueRepository<T>;
    private readonly blockingConnection: { disconnect: () => void };
    private readonly ackConnection: { disconnect: () => void };
    private readonly processingSemaphore: Semaphore;
    private readonly workerId: string;
    private readonly processingPromises: Promise<void>[] = [];
    private readonly prefetchManager: AdaptivePrefetchManager;
    private readonly ackBuffer?: WorkerAckBuffer<T>;
    private readonly contextPool: JobContextPool<T>;
    private readonly creditController: CreditFlowController;

    // Slot prefetch buffers and lock exposed for test introspection
    public readonly jobBuffers = new Map<number, Job<T>[]>();
    public readonly bufferLock: Semaphore = new Semaphore(1);

    private isRunning = false;
    private activeJobs = 0;

    private readonly telemetryData: WorkerTelemetry = {
        fetchCount: 0,
        fetchDurationMs: 0,
        processCount: 0,
        processDurationMs: 0,
        ackCount: 0,
        ackDurationMs: 0,
        idleDurationMs: 0,
    };

    public get activeCount(): number {
        return this.activeJobs;
    }

    public getTelemetry(): WorkerTelemetry {
        return { ...this.telemetryData };
    }

    constructor(
        public readonly name: string,
        private processor: WorkerProcessor<T>,
        private readonly kodiak: Kodiak,
        private opts?: WorkerOptions,
        repositories?: { ack: IQueueRepository<T>; blocking: IQueueRepository<T> },
    ) {
        super();

        const ackConn = this.kodiak.connection.duplicate();
        const blkConn = this.kodiak.connection.duplicate();
        this.ackConnection = ackConn;
        this.blockingConnection = blkConn;

        const serializer = opts?.serializer ?? kodiak.serializer;
        const rateLimiter = opts?.rateLimiter ?? opts?.limiter;
        this.ackQueueRepository =
            repositories?.ack ??
            new DragonflyQueueRepository<T>(
                name,
                ackConn,
                kodiak.prefix,
                serializer,
                undefined,
                rateLimiter,
            );
        const blockingRepo =
            repositories?.blocking ??
            new DragonflyQueueRepository<T>(
                name,
                blkConn,
                kodiak.prefix,
                serializer,
                undefined,
                rateLimiter,
            );

        this.workerId = `${process.pid}-${randomUUID()}`;
        this.fetchJobsUseCase = new FetchJobsUseCase<T>(blockingRepo);
        this.completeJobUseCase = new CompleteJobUseCase<T>(this.ackQueueRepository);
        this.failJobUseCase = new FailJobUseCase<T>(
            this.ackQueueRepository,
            opts?.backoffStrategies,
        );
        this.updateJobProgressUseCase = new UpdateJobProgressUseCase<T>(this.ackQueueRepository);
        this.releaseJobsUseCase = new ReleaseJobsUseCase<T>(this.ackQueueRepository);

        const concurrency = this.opts?.concurrency ?? 1;
        this.processingSemaphore = new Semaphore(concurrency);
        this.prefetchManager = new AdaptivePrefetchManager(concurrency, this.opts?.prefetch);

        const ackPipelining = this.opts?.ackPipelining;
        const isAckPipeliningEnabled =
            ackPipelining === true ||
            (typeof ackPipelining === "object" && ackPipelining.enabled !== false);

        if (isAckPipeliningEnabled) {
            const pipeliningOpts = typeof ackPipelining === "object" ? ackPipelining : {};
            this.ackBuffer = new WorkerAckBuffer<T>(this.completeJobUseCase, {
                maxBatch: pipeliningOpts.maxBatch,
                maxWaitMs: pipeliningOpts.maxWaitMs,
                onCompleted: (job) => this.emit("completed", job),
                onError: (err) => this.emit("error", err),
                onBatchFlushed: (count, durationMs) => {
                    if (this.opts?.telemetry) {
                        this.telemetryData.ackCount += count;
                        this.telemetryData.ackDurationMs += durationMs;
                    }
                },
            });
        }

        const lockDuration = this.opts?.lockDuration ?? 30_000;
        this.contextPool = new JobContextPool<T>(this.name, {
            heartbeatFactory: () => async (jobId, ownerToken) => {
                const expiresAt = Date.now() + lockDuration;
                return this.ackQueueRepository.extendLock(jobId, expiresAt, ownerToken);
            },
        });

        const creditsOption = this.opts?.credits;
        const maxCredits =
            typeof creditsOption === "number"
                ? creditsOption
                : typeof creditsOption === "object"
                  ? creditsOption.maxCredits
                  : concurrency * 20;
        const replenishThreshold =
            typeof creditsOption === "object" ? creditsOption.replenishBatchThreshold : undefined;

        this.creditController = new CreditFlowController({
            maxCredits,
            replenishBatchThreshold: replenishThreshold,
        });
    }

    public async start(): Promise<void> {
        if (this.isRunning) {
            throw new Error(`Worker "${this.name}" is already running`);
        }
        this.isRunning = true;
        this.emit("start");

        const concurrency = this.opts?.concurrency ?? 1;
        for (let i = 0; i < concurrency; i++) {
            this.jobBuffers.set(i, []);
            this.processingPromises.push(this.processSlotLoop(i));
        }
    }

    public async stop(): Promise<void> {
        this.isRunning = false;
        this.disconnectSafe(this.blockingConnection);

        const shutdownTimeout = this.opts?.gracefulShutdownTimeout ?? 30000;
        const ac = new AbortController();
        const timeoutPromise = setTimeout(shutdownTimeout, undefined, {
            signal: ac.signal,
            ref: false,
        }).then(() => {
            throw new Error(`Graceful shutdown timed out after ${shutdownTimeout}ms`);
        });

        try {
            await Promise.race([Promise.all(this.processingPromises), timeoutPromise]);
            if (this.ackBuffer) {
                await this.ackBuffer.drain();
            }
        } catch (error: unknown) {
            if (!(error instanceof Error && error.name === "AbortError")) {
                this.emit("error", error);
            }
        } finally {
            ac.abort();
        }

        await this.releaseUnconsumedJobs();
        this.disconnectSafe(this.ackConnection);
        this.emit("stop");
    }

    private async releaseUnconsumedJobs(): Promise<void> {
        await this.bufferLock.acquire();
        try {
            const unconsumedIds: string[] = [];
            for (const [slot, buffer] of this.jobBuffers.entries()) {
                while (buffer.length > 0) {
                    const item = buffer.shift();
                    if (item) unconsumedIds.push(item.id);
                }
                this.jobBuffers.set(slot, []);
            }
            if (unconsumedIds.length > 0) {
                await this.releaseJobsUseCase.execute(unconsumedIds);
                this.creditController.replenish(unconsumedIds.length);
            }
        } catch (error) {
            this.emit("error", error);
        } finally {
            this.bufferLock.release();
        }
    }

    private disconnectSafe(conn: { disconnect: () => void }): void {
        try {
            conn.disconnect();
        } catch (error) {
            this.emit("error", error);
        }
    }

    public async getJob(slotIndex: number, ownerToken: string): Promise<Job<T> | null> {
        const buffered = this.jobBuffers.get(slotIndex) ?? [];
        if (buffered.length > 0) {
            const nextJob = buffered.shift() ?? null;
            this.jobBuffers.set(slotIndex, buffered);
            return nextJob;
        }

        await this.bufferLock.acquire();
        try {
            if (!this.creditController.hasCredit()) {
                return null;
            }
            const desired = this.prefetchManager.getSize();
            const rateLimiter = this.opts?.rateLimiter ?? this.opts?.limiter;
            const burstCapacity = rateLimiter?.burst ?? rateLimiter?.capacity ?? rateLimiter?.max;
            const effectiveDesired = burstCapacity ? Math.min(desired, burstCapacity) : desired;
            const grantedCredits = this.creditController.consume(effectiveDesired);
            if (grantedCredits <= 0) {
                return null;
            }

            const lockDuration = this.opts?.lockDuration ?? 30_000;
            const t0 = this.opts?.telemetry ? performance.now() : 0;
            const jobs = await this.fetchJobsUseCase.execute(
                grantedCredits,
                lockDuration,
                ownerToken,
            );
            if (this.opts?.telemetry) {
                this.telemetryData.fetchCount++;
                this.telemetryData.fetchDurationMs += performance.now() - t0;
            }

            const fetchedCount = jobs ? jobs.length : 0;
            this.prefetchManager.recordFetchResult(fetchedCount);

            if (fetchedCount < grantedCredits) {
                this.creditController.replenish(grantedCredits - fetchedCount);
            }

            if (fetchedCount === 0 && rateLimiter) {
                this.emit("rateLimited", { requested: grantedCredits });
            }

            if (jobs && jobs.length > 0) {
                const remaining = jobs.slice();
                const job = remaining.shift() as Job<T>;
                this.jobBuffers.set(slotIndex, remaining);
                return job ?? null;
            }
            return null;
        } finally {
            this.bufferLock.release();
        }
    }

    private async processSlotLoop(slotIndex: number): Promise<void> {
        const ownerToken = `${this.workerId}:${slotIndex}`;
        while (this.isRunning) {
            try {
                const job = await this.getJob(slotIndex, ownerToken);
                if (job) {
                    await this.executeJobWithLifecycle(job, ownerToken);
                } else if (this.isRunning) {
                    const t0 = this.opts?.telemetry ? performance.now() : 0;
                    await setTimeout(100);
                    if (this.opts?.telemetry) {
                        this.telemetryData.idleDurationMs += performance.now() - t0;
                    }
                }
            } catch (error) {
                if (error instanceof Error) {
                    this.emit("error", error);
                }
            }
        }
    }

    private async executeJobWithLifecycle(job: Job<T>, ownerToken: string): Promise<void> {
        this.activeJobs++;
        job.startedAt = job.startedAt ?? new Date();
        this.attachJobProgressReporter(job);

        const heartbeat = this.createHeartbeat();
        const pooledContext = this.contextPool.acquire(job, ownerToken);
        const context = Object.assign(job, {
            logger: pooledContext.logger,
            heartbeat: pooledContext.heartbeat,
        }) as JobContext<T> & Job<T>;
        await this.processingSemaphore.acquire();

        try {
            if (heartbeat) heartbeat.start(job.id, ownerToken);
            const t0 = this.opts?.telemetry ? performance.now() : 0;
            await this.processor(context);
            if (this.opts?.telemetry) {
                this.telemetryData.processCount++;
                this.telemetryData.processDurationMs += performance.now() - t0;
            }
            await this.finalizeJobSuccess(job);
        } catch (error) {
            await this.finalizeJobFailure(job, error);
        } finally {
            if (heartbeat) heartbeat.stop();
            this.contextPool.release(pooledContext);
            this.creditController.replenish(1);
            this.processingSemaphore.release();
            this.activeJobs--;
        }
    }

    private attachJobProgressReporter(job: Job<T>): void {
        job.updateProgress = async (progress: number) => {
            await this.updateJobProgressUseCase.execute(job.id, progress);
            job.progress = progress;
            this.emit("progress", job, progress);
        };
    }

    private createHeartbeat(): WorkerHeartbeatManager<T> | null {
        if (!this.opts?.heartbeatEnabled) return null;
        const lockDuration = this.opts?.lockDuration ?? 30_000;
        const interval =
            this.opts?.heartbeatInterval ?? Math.max(1000, Math.floor(lockDuration / 2));

        return new WorkerHeartbeatManager<T>(
            this.ackQueueRepository,
            lockDuration,
            interval,
            (err) => this.emit("error", err),
        );
    }

    private async finalizeJobSuccess(job: Job<T>): Promise<void> {
        if (this.ackBuffer) {
            void this.ackBuffer.push(job).catch(() => {});
            return;
        }

        const t0 = this.opts?.telemetry ? performance.now() : 0;
        await this.completeJobUseCase.execute(job.id);
        if (this.opts?.telemetry) {
            this.telemetryData.ackCount++;
            this.telemetryData.ackDurationMs += performance.now() - t0;
        }
        job.status = "completed";
        job.completedAt = new Date();
        this.emit("completed", job);
    }

    private async finalizeJobFailure(job: Job<T>, rawError: unknown): Promise<void> {
        const error = rawError instanceof Error ? rawError : new Error(String(rawError));
        await this.failJobUseCase.execute(job, error);
        job.status = "failed";
        job.failedAt = new Date();
        job.error = error.message;
        this.emit("failed", job, error);
    }
}
