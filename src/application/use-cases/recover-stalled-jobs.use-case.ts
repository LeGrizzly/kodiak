import type { IQueueRepository } from "../../domain/repositories/queue.repository.js";

export class RecoverStalledJobsUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    public async execute(): Promise<string[]> {
        return this.queueRepository.recoverStalledJobs();
    }
}
