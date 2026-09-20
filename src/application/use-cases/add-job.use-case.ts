import { createHash } from "node:crypto";
import type { Job } from "../../domain/entities/job.entity.js";
import { JobAlreadyExistsError } from "../../domain/errors/job-already-exists.error.js";
import type { IQueueRepository } from "../../domain/repositories/queue.repository.js";
import type { IJobSerializer } from "../../domain/serializers/job-serializer.interface.js";
import type { JobOptions } from "../dtos/job-options.dto.js";

export class AddJobUseCase<T> {
    constructor(
        private readonly queueRepository: IQueueRepository<T>,
        private readonly serializer?: IJobSerializer,
    ) {}

    public async execute(id: string, data: T, options?: JobOptions): Promise<Job<T>> {
        const priority = options?.priority ?? 10;
        const delay =
            options?.delay ?? (options?.waitUntil ? options.waitUntil.getTime() - Date.now() : 0);
        const isDelayed = delay > 0;

        let dedupPayload: { id: string; ttl: number } | undefined;
        let dedupStrategy: "ignore-if-exists" | "throw" = "ignore-if-exists";

        if (options?.deduplication) {
            const dedupOpts =
                typeof options.deduplication === "object" ? options.deduplication : {};
            dedupStrategy = dedupOpts.strategy ?? "ignore-if-exists";

            let dedupId = dedupOpts.id;
            if (!dedupId) {
                let serialized: string | Uint8Array | Buffer;
                if (this.serializer) {
                    serialized = this.serializer.serialize(data);
                } else if (typeof data === "string") {
                    serialized = data;
                } else {
                    serialized = JSON.stringify(data);
                }
                dedupId = createHash("sha256").update(serialized).digest("hex");
            }

            const ttl = dedupOpts.ttl ?? 60_000;
            dedupPayload = { id: dedupId, ttl };
        }

        const job: Job<T> = {
            id,
            data,
            status: isDelayed ? "delayed" : "waiting",
            priority,
            addedAt: new Date(),
            retryCount: 0,
            maxAttempts: options?.attempts ?? 1,
            backoff: options?.backoff,
            repeat: options?.repeat ? { ...options.repeat, count: 0 } : undefined,
            traceparent: options?.traceparent,
            progress: 0,
            updateProgress: async (progress: number) => {
                await this.queueRepository.updateProgress(job.id, progress);
            },
        };

        const score = priority * 10000000000000 + (Date.now() + Math.max(0, delay));
        const result = dedupPayload
            ? await this.queueRepository.add(job, score, isDelayed, dedupPayload)
            : await this.queueRepository.add(job, score, isDelayed);

        if (result && typeof result === "object" && result.isDuplicate) {
            if (dedupStrategy === "throw" && dedupPayload) {
                throw new JobAlreadyExistsError(result.jobId, dedupPayload.id);
            }
            job.isDuplicate = true;
            job.id = result.jobId;
        }

        return job;
    }
}
