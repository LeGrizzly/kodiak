import { EventEmitter } from "node:events";
import type { JobOptions } from "../application/dtos/job-options.dto.js";
import { AddJobUseCase } from "../application/use-cases/add-job.use-case.js";
import type { Job } from "../domain/entities/job.entity.js";
import type { IQueueRepository } from "../domain/repositories/queue.repository.js";
import type { IJobSerializer } from "../domain/serializers/job-serializer.interface.js";
import {
    DragonflyQueueRepository,
    type PipeliningOptions,
} from "../infrastructure/dragonfly/dragonfly-queue.repository.js";
import type { Kodiak } from "./kodiak.js";

export class Queue<T> extends EventEmitter {
    private readonly addJobUseCase: AddJobUseCase<T>;
    private readonly queueRepository: IQueueRepository<T>;
    private schedulerInterval: NodeJS.Timeout | null = null;
    private recoveringStalledJobs = false;
    private readonly connection: { quit: () => Promise<unknown> };

    constructor(
        public readonly name: string,
        private readonly kodiak: Kodiak,
        repository?: IQueueRepository<T>,
        serializer?: IJobSerializer,
        pipelining?: PipeliningOptions,
    ) {
        super();

        const conn = this.kodiak.connection.duplicate();
        this.connection = conn;
        this.queueRepository =
            repository ??
            new DragonflyQueueRepository<T>(
                name,
                conn,
                this.kodiak.prefix,
                serializer ?? this.kodiak.serializer,
                pipelining ?? this.kodiak.pipelining,
            );

        this.addJobUseCase = new AddJobUseCase<T>(this.queueRepository);

        this.startScheduler();
    }

    public async add(id: string, data: T, options?: JobOptions): Promise<Job<T>> {
        return this.addJobUseCase.execute(id, data, options);
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
