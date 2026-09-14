import type { Job } from "../../domain/entities/job.entity.js";

export interface IJobLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
}

export interface JobContext<T> {
    job: Job<T>;
    data: T;
    logger: IJobLogger;
    updateProgress: (progress: number) => Promise<void>;
    heartbeat: () => Promise<boolean>;
}
