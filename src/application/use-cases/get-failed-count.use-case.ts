import type { IDLQRepository } from "../../domain/repositories/queue.repository.js";

export class GetFailedCountUseCase<T> {
    constructor(private readonly repository: IDLQRepository<T>) {}

    public async execute(): Promise<number> {
        return this.repository.getFailedCount();
    }
}
