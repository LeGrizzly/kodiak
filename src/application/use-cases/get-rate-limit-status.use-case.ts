import type {
    IRateLimiterRepository,
    IRateLimitStatus,
} from "../../domain/repositories/queue.repository.js";

/**
 * Use case to inspect the current rate limiting state of a queue.
 */
export class GetRateLimitStatusUseCase {
    constructor(private readonly repository: IRateLimiterRepository) {}

    public async execute(): Promise<IRateLimitStatus | null> {
        if (!this.repository.getRateLimitStatus) {
            return null;
        }
        return this.repository.getRateLimitStatus();
    }
}
