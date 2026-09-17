import type { IDLQRepository } from "../../domain/repositories/queue.repository.js";

export class CleanFailedJobsUseCase<T> {
    constructor(private readonly repository: IDLQRepository<T>) {}

    public async execute(olderThanMs = 0): Promise<number> {
        return this.repository.cleanFailed(olderThanMs);
    }
}
