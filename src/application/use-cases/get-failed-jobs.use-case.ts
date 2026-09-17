import type { Job } from "../../domain/entities/job.entity.js";
import type { IDLQRepository } from "../../domain/repositories/queue.repository.js";

export class GetFailedJobsUseCase<T> {
    constructor(private readonly repository: IDLQRepository<T>) {}

    public async execute(start = 0, limit = 20): Promise<Job<T>[]> {
        return this.repository.getFailedJobs(start, limit);
    }
}
