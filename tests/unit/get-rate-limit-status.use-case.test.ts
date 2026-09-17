import { beforeEach, describe, expect, it, type Mocked, vi } from "vitest";
import { GetRateLimitStatusUseCase } from "../../src/application/use-cases/get-rate-limit-status.use-case.js";
import type {
    IRateLimiterRepository,
    IRateLimitStatus,
} from "../../src/domain/repositories/queue.repository.js";

describe("Unit: GetRateLimitStatusUseCase", () => {
    let repository: Mocked<IRateLimiterRepository>;
    let useCase: GetRateLimitStatusUseCase;

    beforeEach(() => {
        repository = {
            consumeRateLimit: vi.fn<IRateLimiterRepository["consumeRateLimit"]>(),
            getRateLimitStatus: vi.fn<IRateLimiterRepository["getRateLimitStatus"]>(),
        };
        useCase = new GetRateLimitStatusUseCase(repository);
    });

    it("should return rate limit status from repository", async () => {
        const expectedStatus: IRateLimitStatus = {
            tokens: 42,
            max: 100,
            duration: 60000,
            resetAt: new Date("2026-09-17T12:00:00.000Z"),
        };
        repository.getRateLimitStatus.mockResolvedValue(expectedStatus);

        const status = await useCase.execute();

        expect(repository.getRateLimitStatus).toHaveBeenCalled();
        expect(status).toEqual(expectedStatus);
    });

    it("should return null if repository returns null (no rate limiter configured)", async () => {
        repository.getRateLimitStatus.mockResolvedValue(null);

        const status = await useCase.execute();

        expect(repository.getRateLimitStatus).toHaveBeenCalled();
        expect(status).toBeNull();
    });

    it("should return null if repository does not implement getRateLimitStatus", async () => {
        const repoWithoutStatus: IRateLimiterRepository = {} as unknown as IRateLimiterRepository;
        const fallbackUseCase = new GetRateLimitStatusUseCase(repoWithoutStatus);

        const status = await fallbackUseCase.execute();

        expect(status).toBeNull();
    });
});
