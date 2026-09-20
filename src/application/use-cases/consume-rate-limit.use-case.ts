import type { IRateLimiterRepository } from "../../domain/repositories/queue.repository.js";

/**
 * Use case to consume rate limiting tokens from a queue.
 */
export class ConsumeRateLimitUseCase {
    constructor(private readonly repository: IRateLimiterRepository) {}

    public async execute(count = 1): Promise<boolean> {
        if (!this.repository.consumeRateLimit) {
            return true;
        }
        return this.repository.consumeRateLimit(count);
    }
}
