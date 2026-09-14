import type { IQueueRepository } from "../../domain/repositories/queue.repository.js";

export class ReleaseJobsUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    public async execute(jobIds: string[]): Promise<void> {
        if (!jobIds || jobIds.length === 0) return;
        await this.queueRepository.releaseJobs(jobIds);
    }
}
