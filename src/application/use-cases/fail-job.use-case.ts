import type { Job } from "../../domain/entities/job.entity.js";
import type { IQueueRepository } from "../../domain/repositories/queue.repository.js";
import type { BackoffStrategy } from "../../domain/strategies/backoff.strategy.js";

export class FailJobUseCase<T> {
    constructor(
        private readonly queueRepository: IQueueRepository<T>,
        private readonly backoffStrategies: Record<string, BackoffStrategy> = {},
    ) {}

    public async execute(job: Job<T>, error: Error, ownerToken?: string): Promise<void> {
        const nextAttempt = this.computeNextAttempt(job);
        await this.queueRepository.markAsFailed(
            job.id,
            error.message,
            new Date(),
            nextAttempt,
            ownerToken,
            error.stack,
        );
    }

    private computeNextAttempt(job: Job<T>): Date | undefined {
        if (!job.backoff) return undefined;

        const { type, delay } = job.backoff;
        const attemptsMade = job.retryCount + 1;
        const strategyDelay = this.resolveBackoffDelay(type, delay, attemptsMade);

        return strategyDelay !== null ? new Date(Date.now() + strategyDelay) : undefined;
    }

    private resolveBackoffDelay(type: string, delay: number, attemptsMade: number): number | null {
        if (type === "fixed") return delay;
        if (type === "exponential") return delay * Math.pow(2, attemptsMade - 1);
        const customStrategy = this.backoffStrategies[type];
        return customStrategy ? customStrategy(attemptsMade, delay) : null;
    }
}
