import type { IDLQRepository } from "../../domain/repositories/queue.repository.js";

export class RetryFailedJobUseCase<T> {
    constructor(private readonly repository: IDLQRepository<T>) {}

    public async execute(jobId: string): Promise<boolean> {
        return this.repository.retryJob(jobId);
    }

    public async executeAll(limit = 100): Promise<number> {
        return this.repository.retryAllFailed(limit);
    }
}
