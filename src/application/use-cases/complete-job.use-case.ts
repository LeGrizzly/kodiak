import type { IQueueRepository } from "../../domain/repositories/queue.repository.js";

export class CompleteJobUseCase<T> {
    constructor(private readonly queueRepository: IQueueRepository<T>) {}

    public async execute(jobId: string, ownerToken?: string): Promise<void> {
        if (ownerToken !== undefined) {
            await this.queueRepository.markAsCompleted(jobId, new Date(), ownerToken);
        } else {
            await this.queueRepository.markAsCompleted(jobId, new Date());
        }
    }

    public async executeMany(
        jobs: Array<{ jobId: string; ownerToken?: string; completedAt?: Date }>,
    ): Promise<void> {
        if (jobs.length === 0) return;
        const now = new Date();
        const batch = jobs.map((j) => ({
            jobId: j.jobId,
            completedAt: j.completedAt ?? now,
            ownerToken: j.ownerToken,
        }));

        if (typeof this.queueRepository.markManyAsCompleted === "function") {
            await this.queueRepository.markManyAsCompleted(batch);
        } else {
            await Promise.all(
                batch.map((j) =>
                    this.queueRepository.markAsCompleted(j.jobId, j.completedAt, j.ownerToken),
                ),
            );
        }
    }
}
