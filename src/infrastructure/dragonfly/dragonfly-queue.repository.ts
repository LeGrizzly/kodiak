import type { Redis } from "ioredis";
import type { RateLimiterOptions } from "../../application/dtos/rate-limiter-options.dto.js";
import type { Job, JobErrorInfo, JobStatus } from "../../domain/entities/job.entity.js";
import type {
    AddJobResult,
    BatchCompletedJob,
    IDLQRepository,
    IQueueRepository,
    IRateLimiterRepository,
    IRateLimitStatus,
} from "../../domain/repositories/queue.repository.js";
import type { IJobSerializer } from "../../domain/serializers/job-serializer.interface.js";
import { MsgpackJobSerializer } from "../serializers/msgpack-job.serializer.js";
import type { IConnection } from "./dragonfly-connection.js";
import { DragonflyKeyTopology } from "./dragonfly-key-topology.js";
import { DragonflyScriptManager, type ScriptName } from "./dragonfly-script-manager.js";

export interface PipeliningOptions {
    maxWaitMs?: number;
    maxBatch?: number;
}

interface PendingAdd<T> {
    job: Job<T>;
    score: number;
    isDelayed: boolean;
    deduplication?: { id: string; ttl: number };
    resolve: (result: AddJobResult) => void;
    reject: (err: Error) => void;
}

interface PendingComplete {
    jobId: string;
    completedAt: Date;
    ownerToken?: string;
    resolve: () => void;
    reject: (err: Error) => void;
}

export class DragonflyQueueRepository<T>
    implements IQueueRepository<T>, IDLQRepository<T>, IRateLimiterRepository
{
    public readonly queueName: string;
    private readonly redisClient: Redis;
    private readonly keyTopology: DragonflyKeyTopology;
    private readonly scriptManager: DragonflyScriptManager;
    private readonly serializer: IJobSerializer;
    private readonly pipelining?: PipeliningOptions;
    private readonly rateLimiter?: RateLimiterOptions;
    private readonly pendingAdds: PendingAdd<T>[] = [];
    private readonly pendingCompletes: PendingComplete[] = [];
    private pipelineFlushScheduled = false;
    private completePipelineFlushScheduled = false;

    constructor(
        queueName: string,
        connection: Redis | IConnection,
        prefix = "kodiak",
        serializer?: IJobSerializer,
        pipelining?: PipeliningOptions,
        rateLimiter?: RateLimiterOptions,
    ) {
        this.queueName = queueName;
        this.redisClient = "getRawClient" in connection ? connection.getRawClient() : connection;
        this.keyTopology = new DragonflyKeyTopology(prefix, queueName);
        this.scriptManager = DragonflyScriptManager.getInstance();
        this.serializer = serializer ?? new MsgpackJobSerializer();
        this.pipelining = pipelining;
        this.rateLimiter = rateLimiter;
    }

    public async add(
        job: Job<T>,
        score: number,
        isDelayed: boolean,
        deduplication?: { id: string; ttl: number },
    ): Promise<AddJobResult> {
        if (this.pipelining) {
            return new Promise<AddJobResult>((resolve, reject) => {
                this.pendingAdds.push({ job, score, isDelayed, deduplication, resolve, reject });
                const maxBatch = this.pipelining?.maxBatch ?? 200;
                if (this.pendingAdds.length >= maxBatch) {
                    this.flushPipelinedAdds();
                } else if (!this.pipelineFlushScheduled) {
                    this.schedulePipelineFlush();
                }
            });
        }
        return this.executeAdd(job, score, isDelayed, deduplication);
    }

    private schedulePipelineFlush(): void {
        this.pipelineFlushScheduled = true;
        const waitMs = this.pipelining?.maxWaitMs ?? 0;
        if (waitMs > 0) {
            const timer = setTimeout(() => this.flushPipelinedAdds(), waitMs);
            if (timer && typeof timer.unref === "function") timer.unref();
        } else {
            queueMicrotask(() => this.flushPipelinedAdds());
        }
    }

    private async executeAdd(
        job: Job<T>,
        score: number,
        isDelayed: boolean,
        deduplication?: { id: string; ttl: number },
    ): Promise<AddJobResult> {
        const jobKey = this.keyTopology.jobKey(job.id);
        const jobFields = this.createJobFields(job);

        const keys = [
            this.keyTopology.waitingKey,
            this.keyTopology.delayedKey,
            jobKey,
            this.keyTopology.notifyKey,
        ];

        let args: (string | number)[];

        if (deduplication?.id) {
            const dedupKey = this.keyTopology.dedupKey(deduplication.id);
            keys.push(dedupKey);
            args = [
                job.id,
                String(score),
                isDelayed ? "1" : "0",
                String(deduplication.ttl),
                ...jobFields,
            ];
        } else {
            args = [job.id, String(score), isDelayed ? "1" : "0", ...jobFields];
        }

        const res = (await this.scriptManager.execute(this.redisClient, "add_job", keys, args)) as
            | [number, string]
            | string
            | undefined;

        let isDuplicate = false;
        let finalJobId = job.id;

        if (Array.isArray(res)) {
            isDuplicate = res[0] === 0;
            finalJobId = String(res[1]);
        }

        return { isDuplicate, jobId: finalJobId };
    }

    private flushPipelinedAdds(): void {
        this.pipelineFlushScheduled = false;
        const maxBatch = this.pipelining?.maxBatch ?? 200;
        const batch = this.pendingAdds.splice(0, maxBatch);
        if (batch.length === 0) return;

        const pipeline = this.redisClient.pipeline();
        for (const item of batch) {
            const jobKey = this.keyTopology.jobKey(item.job.id);
            const fields = this.createJobFields(item.job);
            const keys = [
                this.keyTopology.waitingKey,
                this.keyTopology.delayedKey,
                jobKey,
                this.keyTopology.notifyKey,
            ];
            let args: (string | number)[];
            if (item.deduplication?.id) {
                const dedupKey = this.keyTopology.dedupKey(item.deduplication.id);
                keys.push(dedupKey);
                args = [
                    item.job.id,
                    String(item.score),
                    item.isDelayed ? "1" : "0",
                    String(item.deduplication.ttl),
                    ...fields,
                ];
            } else {
                args = [item.job.id, String(item.score), item.isDelayed ? "1" : "0", ...fields];
            }
            this.appendScriptToPipeline(pipeline, "add_job", keys, args);
        }

        pipeline
            .exec()
            .then((results) => {
                this.resolvePipelineBatch(batch, results);
            })
            .catch((err: Error) => {
                for (const item of batch) item.reject(err);
            });
    }

    private scheduleCompletePipelineFlush(): void {
        this.completePipelineFlushScheduled = true;
        const waitMs = this.pipelining?.maxWaitMs ?? 0;
        if (waitMs > 0) {
            const timer = setTimeout(() => this.flushPipelinedCompletes(), waitMs);
            if (timer && typeof timer.unref === "function") timer.unref();
        } else {
            queueMicrotask(() => this.flushPipelinedCompletes());
        }
    }

    private flushPipelinedCompletes(): void {
        this.completePipelineFlushScheduled = false;
        const maxBatch = this.pipelining?.maxBatch ?? 200;
        const batch = this.pendingCompletes.splice(0, maxBatch);
        if (batch.length === 0) return;

        this.markManyAsCompleted(batch)
            .then(() => {
                for (const item of batch) item.resolve();
            })
            .catch((err: Error) => {
                for (const item of batch) item.reject(err);
            });
    }

    private appendScriptToPipeline(
        pipeline: ReturnType<Redis["pipeline"]>,
        scriptName: ScriptName,
        keys: string[],
        args: (string | number)[],
    ): void {
        const sha = this.scriptManager.getScriptSha(scriptName);
        const code = this.scriptManager.getScriptCode(scriptName);
        const stringArgs = args.map((a) => String(a));
        if (typeof pipeline.evalsha === "function" && sha) {
            pipeline.evalsha(sha, keys.length, ...keys, ...stringArgs);
        } else {
            pipeline.eval(code, keys.length, ...keys, ...stringArgs);
        }
    }

    private resolvePipelineBatch(
        batch: PendingAdd<T>[],
        results: [Error | null, unknown][] | null,
    ): void {
        if (!results) {
            for (const item of batch) item.reject(new Error("Pipeline execution returned null"));
            return;
        }
        for (let i = 0; i < batch.length; i++) {
            const res = results[i];
            const item = batch[i];
            if (!item) continue;
            if (res?.[0]) {
                item.reject(res[0]);
            } else {
                let isDuplicate = false;
                let finalJobId = item.job.id;
                const value = res?.[1];
                if (Array.isArray(value)) {
                    isDuplicate = value[0] === 0;
                    finalJobId = String(value[1]);
                }
                item.resolve({ isDuplicate, jobId: finalJobId });
            }
        }
    }

    private createJobFields(job: Job<T>): (string | number)[] {
        const rawData = this.serializer.serialize(job.data);
        const dataStr =
            typeof rawData === "string"
                ? rawData
                : Buffer.isBuffer(rawData)
                  ? rawData.toString("latin1")
                  : Buffer.from(rawData).toString("latin1");

        const jobFields: (string | number)[] = [
            "data",
            dataStr,
            "priority",
            String(job.priority),
            "retry_count",
            String(job.retryCount),
            "max_attempts",
            String(job.maxAttempts),
            "added_at",
            String(job.addedAt.getTime()),
        ];

        if (job.traceparent) {
            jobFields.push("traceparent", job.traceparent);
        }

        if (job.backoff) {
            jobFields.push("backoff_type", job.backoff.type);
            jobFields.push("backoff_delay", String(job.backoff.delay));
        }

        if (job.repeat) {
            jobFields.push("repeat_every", String(job.repeat.every));
            jobFields.push("repeat_count", String(job.repeat.count));
            if (job.repeat.limit !== undefined) {
                jobFields.push("repeat_limit", String(job.repeat.limit));
            }
        }

        return jobFields;
    }

    public async fetchNext(timeout?: number): Promise<Job<T> | null> {
        if (this.rateLimiter) {
            const allowed = await this.consumeRateLimit(1);
            if (!allowed) {
                if (this.rateLimiter.onExceeded !== "reject") {
                    await this.moveWaitingToDelayedWithDelay(this.rateLimiter.retryDelay ?? 500);
                }
                return null;
            }
        }

        const now = Date.now();
        const rawOptimistic = await this.scriptManager.execute(
            this.redisClient,
            "move_job",
            [this.keyTopology.waitingKey, this.keyTopology.activeKey, this.keyTopology.notifyKey],
            [String(now), "30000", "1"],
        );

        if (rawOptimistic) {
            const normalized = this.normalizeFetchResult(rawOptimistic);
            return this.processFetchResult(normalized, now);
        }

        if (timeout && timeout > 0) {
            const popResult = await this.redisClient.brpop(this.keyTopology.notifyKey, timeout);
            if (!popResult) return null;
        } else {
            return null;
        }

        const rawWaited = await this.scriptManager.execute(
            this.redisClient,
            "move_job",
            [this.keyTopology.waitingKey, this.keyTopology.activeKey, this.keyTopology.notifyKey],
            [String(now), "30000", "0"],
        );

        if (rawWaited) {
            const normalized = this.normalizeFetchResult(rawWaited);
            return this.processFetchResult(normalized, now);
        }

        return null;
    }

    private normalizeFetchResult(raw: unknown): [string, string[] | null] {
        if (typeof raw === "string") {
            return [raw, null];
        }
        if (Array.isArray(raw)) {
            return [raw[0] as string, (raw[1] as string[] | null) ?? null];
        }
        return ["", null];
    }

    private async processFetchResult(
        result: [string, string[] | null],
        now: number,
    ): Promise<Job<T> | null> {
        const [jobId, rawData] = result;
        if (!jobId) return null;
        const jobKey = this.keyTopology.jobKey(jobId);

        let jobData: Record<string, string>;

        if (rawData && rawData.length > 0) {
            jobData = {};
            for (let i = 0; i < rawData.length; i += 2) {
                const k = rawData[i];
                const v = rawData[i + 1];
                if (k !== undefined && v !== undefined) {
                    jobData[k] = v;
                }
            }
        } else {
            const pipeline = this.redisClient.pipeline();
            pipeline.hset(jobKey, "state", "active", "started_at", String(now));
            pipeline.hgetall(jobKey);
            const results = await pipeline.exec();

            if (!results) return null;

            const secondResult = results[1];
            if (!secondResult) return null;
            const [err, data] = secondResult as [Error | null, Record<string, string>];
            if (err || !data) return null;
            jobData = data;
        }

        if (!jobData.data) return null;
        return this.buildJobFromRecord(jobId, jobData, now);
    }

    public async fetchNextJobs(
        count: number,
        lockDuration: number,
        ownerToken?: string,
    ): Promise<Job<T>[]> {
        if (this.rateLimiter) {
            const allowed = await this.consumeRateLimit(count);
            if (!allowed) {
                if (this.rateLimiter.onExceeded !== "reject") {
                    await this.moveWaitingToDelayedWithDelay(this.rateLimiter.retryDelay ?? 500);
                }
                return [];
            }
        }

        const now = Date.now();
        const lockExpiresAt = now + lockDuration;

        const rawResult = await this.scriptManager.execute(
            this.redisClient,
            "move_to_active",
            [this.keyTopology.waitingKey, this.keyTopology.activeKey],
            [String(count), String(lockExpiresAt)],
        );

        if (!rawResult || !Array.isArray(rawResult) || rawResult.length === 0) {
            return [];
        }

        if (Array.isArray(rawResult[0])) {
            const jobs: Job<T>[] = [];
            for (const item of rawResult as [string, string[]][]) {
                const job = this.buildJobFromRaw(item[0], item[1], now);
                if (job) jobs.push(job);
            }
            return jobs;
        }

        const jobIds = rawResult as string[];
        const pipeline = this.redisClient.pipeline();
        for (const jobId of jobIds) {
            const jobKey = this.keyTopology.jobKey(jobId);
            if (ownerToken) {
                pipeline.hset(
                    jobKey,
                    "state",
                    "active",
                    "started_at",
                    String(now),
                    "lock_owner",
                    ownerToken,
                );
            } else {
                pipeline.hset(jobKey, "state", "active", "started_at", String(now));
            }
            pipeline.hgetall(jobKey);
        }

        const results = await pipeline.exec();
        if (!results) return [];

        const jobs: Job<T>[] = [];
        for (let i = 0; i < results.length; i += 2) {
            const resultEntry = results[i + 1];
            if (!resultEntry) continue;
            const [err, record] = resultEntry as [Error | null, Record<string, string>];
            const jobId = jobIds[i / 2];
            if (!err && record && jobId) {
                const job = this.buildJobFromRecord(jobId, record, now);
                if (job) jobs.push(job);
            }
        }
        return jobs;
    }

    public async markAsCompleted(
        jobId: string,
        completedAt: Date,
        ownerToken?: string,
    ): Promise<void> {
        if (this.pipelining) {
            return new Promise<void>((resolve, reject) => {
                this.pendingCompletes.push({ jobId, completedAt, ownerToken, resolve, reject });
                const maxBatch = this.pipelining?.maxBatch ?? 200;
                if (this.pendingCompletes.length >= maxBatch) {
                    this.flushPipelinedCompletes();
                } else if (!this.completePipelineFlushScheduled) {
                    this.scheduleCompletePipelineFlush();
                }
            });
        }
        return this.executeMarkAsCompleted(jobId, completedAt, ownerToken);
    }

    public async markManyAsCompleted(jobs: BatchCompletedJob[]): Promise<void> {
        if (jobs.length === 0) return;
        const pipeline = this.redisClient.pipeline();
        for (const item of jobs) {
            const jobKey = this.keyTopology.jobKey(item.jobId);
            const keys = [this.keyTopology.activeKey, jobKey, this.keyTopology.delayedKey];
            const args = [item.jobId, String(item.completedAt.getTime())];
            if (item.ownerToken) args.push(item.ownerToken);
            this.appendScriptToPipeline(pipeline, "complete_job", keys, args);
        }

        const results = await pipeline.exec();
        if (!results) {
            throw new Error("Pipeline execution returned null");
        }
        for (const [err] of results) {
            if (err) throw err;
        }
    }

    private async executeMarkAsCompleted(
        jobId: string,
        completedAt: Date,
        ownerToken?: string,
    ): Promise<void> {
        const jobKey = this.keyTopology.jobKey(jobId);
        const args: string[] = [jobId, String(completedAt.getTime())];
        if (ownerToken) args.push(ownerToken);

        await this.scriptManager.execute(
            this.redisClient,
            "complete_job",
            [this.keyTopology.activeKey, jobKey, this.keyTopology.delayedKey],
            args,
        );
    }

    public async markAsFailed(
        jobId: string,
        error: string,
        failedAt: Date,
        nextAttempt?: Date,
        ownerToken?: string,
        errorStack?: string,
    ): Promise<void> {
        const jobKey = this.keyTopology.jobKey(jobId);
        const args: string[] = [
            jobId,
            error,
            String(failedAt.getTime()),
            nextAttempt ? String(nextAttempt.getTime()) : "-1",
            ownerToken ?? "",
            errorStack ?? "",
        ];

        await this.scriptManager.execute(
            this.redisClient,
            "fail_job",
            [
                this.keyTopology.activeKey,
                jobKey,
                this.keyTopology.delayedKey,
                this.keyTopology.deadKey,
            ],
            args,
        );
    }

    public async updateProgress(jobId: string, progress: number): Promise<void> {
        const jobKey = this.keyTopology.jobKey(jobId);
        await this.scriptManager.execute(
            this.redisClient,
            "update_progress",
            [jobKey],
            [String(progress)],
        );
    }

    public async promoteDelayedJobs(limit = 50): Promise<number> {
        const now = Date.now();
        const raw = await this.scriptManager.execute(
            this.redisClient,
            "promote_delayed_jobs",
            [this.keyTopology.delayedKey, this.keyTopology.waitingKey, this.keyTopology.notifyKey],
            [String(now), String(limit)],
        );

        if (!raw) return 0;
        if (typeof raw === "number") return raw;
        if (Array.isArray(raw)) {
            if (raw.length === 0) return 0;
            const pipeline = this.redisClient.pipeline();
            for (const jobId of raw as string[]) {
                pipeline.hset(this.keyTopology.jobKey(jobId), "state", "waiting");
            }
            await pipeline.exec();
            return raw.length;
        }
        return 0;
    }

    public async recoverStalledJobs(): Promise<string[]> {
        const now = Date.now();
        const ids = (await this.scriptManager.execute(
            this.redisClient,
            "detect_and_recover_stalled_jobs",
            [this.keyTopology.activeKey, this.keyTopology.waitingKey, this.keyTopology.notifyKey],
            [String(now)],
        )) as string[] | null;

        if (!ids || !Array.isArray(ids) || ids.length === 0) return [];

        const pipeline = this.redisClient.pipeline();
        for (const id of ids) {
            const jobKey = this.keyTopology.jobKey(id);
            pipeline.hincrby(jobKey, "retry_count", 1);
            pipeline.hset(jobKey, "state", "waiting", "updated_at", String(now));
            pipeline.hdel(jobKey, "lock_owner");
        }
        await pipeline.exec();
        return ids;
    }

    public async releaseJobs(jobIds: string[]): Promise<void> {
        if (!jobIds || jobIds.length === 0) return;
        const now = Date.now();
        await this.scriptManager.execute(
            this.redisClient,
            "release_jobs",
            [this.keyTopology.activeKey, this.keyTopology.waitingKey, this.keyTopology.notifyKey],
            [String(now), ...jobIds],
        );

        const pipeline = this.redisClient.pipeline();
        for (const jobId of jobIds) {
            const jobKey = this.keyTopology.jobKey(jobId);
            pipeline.hdel(jobKey, "lock_owner");
            pipeline.hset(jobKey, "state", "waiting");
        }
        await pipeline.exec();
    }

    public async extendLock(
        jobId: string,
        lockExpiresAt: number,
        ownerToken?: string,
    ): Promise<boolean> {
        const jobKey = this.keyTopology.jobKey(jobId);
        const res = await this.scriptManager.execute(
            this.redisClient,
            "extend_lock",
            [this.keyTopology.activeKey, jobKey],
            [jobId, String(lockExpiresAt), ownerToken ?? ""],
        );
        return Number(res) === 1;
    }

    public async getFailedCount(): Promise<number> {
        return this.redisClient.zcard(this.keyTopology.deadKey);
    }

    public async getFailedJobs(start = 0, limit = 20): Promise<Job<T>[]> {
        const stop = start + limit - 1;
        const jobIds = await this.redisClient.zrevrange(this.keyTopology.deadKey, start, stop);
        if (!jobIds || jobIds.length === 0) return [];

        const pipeline = this.redisClient.pipeline();
        for (const jobId of jobIds) {
            pipeline.hgetall(this.keyTopology.jobKey(jobId));
        }

        const results = await pipeline.exec();
        if (!results) return [];

        const now = Date.now();
        const jobs: Job<T>[] = [];
        for (let i = 0; i < results.length; i++) {
            const entry = results[i];
            if (!entry) continue;
            const [err, record] = entry as [Error | null, Record<string, string>];
            const jobId = jobIds[i];
            if (!err && record && jobId) {
                const job = this.buildJobFromRecord(jobId, record, now);
                if (job) jobs.push(job);
            }
        }
        return jobs;
    }

    public async retryJob(jobId: string): Promise<boolean> {
        const jobKey = this.keyTopology.jobKey(jobId);
        const now = Date.now();
        const res = await this.scriptManager.execute(
            this.redisClient,
            "retry_failed_job",
            [
                this.keyTopology.deadKey,
                this.keyTopology.waitingKey,
                this.keyTopology.notifyKey,
                jobKey,
            ],
            [jobId, String(now)],
        );
        return Number(res) === 1;
    }

    public async retryAllFailed(limit = 100): Promise<number> {
        const jobIds = await this.redisClient.zrange(
            this.keyTopology.deadKey,
            0,
            String(limit - 1),
        );
        if (!jobIds || jobIds.length === 0) return 0;

        let retriedCount = 0;
        for (const jobId of jobIds) {
            const success = await this.retryJob(jobId);
            if (success) retriedCount++;
        }
        return retriedCount;
    }

    public async cleanFailed(olderThanMs = 0): Promise<number> {
        const maxTimestamp = olderThanMs > 0 ? String(Date.now() - olderThanMs) : "+inf";
        const res = await this.scriptManager.execute(
            this.redisClient,
            "clean_failed_jobs",
            [this.keyTopology.deadKey],
            [maxTimestamp, this.keyTopology.jobKeyPrefix, "500"],
        );
        return Number(res) || 0;
    }

    private buildJobFromRaw(jobId: string, raw: string[] | null, now: number): Job<T> | null {
        if (!raw || raw.length === 0) return null;
        const record: Record<string, string> = {};
        for (let i = 0; i < raw.length; i += 2) {
            const k = raw[i];
            const v = raw[i + 1];
            if (k !== undefined && v !== undefined) {
                record[k] = v;
            }
        }
        return this.buildJobFromRecord(jobId, record, now);
    }

    private buildJobFromRecord(
        jobId: string,
        data: Record<string, string>,
        now: number,
    ): Job<T> | null {
        if (!data.data) return null;

        let errorHistory: JobErrorInfo[] | undefined;
        if (data.prev_error) {
            errorHistory = [
                {
                    error: data.prev_error,
                    failedAt: new Date(Number(data.prev_failed_at) || now),
                },
            ];
        }

        return {
            id: jobId,
            data: this.serializer.deserialize<T>(data.data),
            priority: Number(data.priority) || 10,
            status: (data.state as JobStatus) || "active",
            retryCount: Number(data.retry_count) || 0,
            maxAttempts: Number(data.max_attempts) || 1,
            addedAt: new Date(Number(data.added_at) || now),
            startedAt: data.started_at ? new Date(Number(data.started_at)) : new Date(now),
            failedAt: data.failed_at ? new Date(Number(data.failed_at)) : undefined,
            error: data.error,
            errorHistory,
            traceparent: data.traceparent,
            progress: data.progress ? Number(data.progress) : 0,
            updateProgress: async (progress: number) => {
                await this.updateProgress(jobId, progress);
            },
        };
    }

    public async consumeRateLimit(count = 1): Promise<boolean> {
        if (!this.rateLimiter) return true;
        const now = Date.now();
        const max = this.rateLimiter.max ?? this.rateLimiter.rate ?? 100;
        const duration = this.rateLimiter.duration ?? 1000;
        const capacity = this.rateLimiter.burst ?? this.rateLimiter.capacity ?? max;
        const refillRatePerMs = max / duration;

        const raw = await this.scriptManager.execute(
            this.redisClient,
            "token_bucket",
            [this.keyTopology.rateLimitKey],
            [String(capacity), String(refillRatePerMs), String(now), String(count)],
        );

        if (Array.isArray(raw)) {
            return Number(raw[0]) === 1;
        }
        return Number(raw) === 1;
    }

    public async getRateLimitStatus(): Promise<IRateLimitStatus | null> {
        if (!this.rateLimiter) return null;
        const now = Date.now();
        const max = this.rateLimiter.max ?? this.rateLimiter.rate ?? 100;
        const duration = this.rateLimiter.duration ?? 1000;
        const capacity = this.rateLimiter.burst ?? this.rateLimiter.capacity ?? max;
        const refillRatePerMs = max / duration;

        const raw = await this.scriptManager.execute(
            this.redisClient,
            "token_bucket",
            [this.keyTopology.rateLimitKey],
            [String(capacity), String(refillRatePerMs), String(now), "0"],
        );

        let tokens = capacity;
        let delayNeededMs = 0;
        if (Array.isArray(raw)) {
            tokens = Number(raw[1]);
            delayNeededMs = Number(raw[2]);
        }

        return {
            tokens,
            max: capacity,
            duration,
            resetAt: delayNeededMs > 0 ? new Date(now + delayNeededMs) : new Date(now),
        };
    }

    private async moveWaitingToDelayedWithDelay(delayMs: number): Promise<string | null> {
        try {
            const now = Date.now();
            const nextAttempt = now + Math.max(0, delayMs);
            const res = await this.scriptManager.execute(
                this.redisClient,
                "move_waiting_to_delayed",
                [this.keyTopology.waitingKey, this.keyTopology.delayedKey],
                [String(nextAttempt)],
            );
            if (!res) return null;
            if (Array.isArray(res) && res[0]) {
                return String(res[0]);
            }
            return String(res);
        } catch {
            return null;
        }
    }

    public async deleteDeduplicationKey(dedupId: string): Promise<boolean> {
        const key = this.keyTopology.dedupKey(dedupId);
        const deleted = await this.redisClient.del(key);
        return deleted > 0;
    }
}
