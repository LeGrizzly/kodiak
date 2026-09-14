import type { IQueueRepository } from "../../domain/repositories/queue.repository.js";

export class PromoteDelayedJobsUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    public async execute(limit = 50): Promise<number> {
        return this.queueRepository.promoteDelayedJobs(limit);
    }
}
