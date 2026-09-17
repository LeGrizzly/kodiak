import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ConsumeRateLimitUseCase } from "../../src/application/use-cases/consume-rate-limit.use-case.js";
import type { IRateLimiterRepository } from "../../src/domain/repositories/queue.repository.js";

describe("Unit: ConsumeRateLimitUseCase", () => {
    let repository: jest.Mocked<IRateLimiterRepository>;
    let useCase: ConsumeRateLimitUseCase;

    beforeEach(() => {
        repository = {
            consumeRateLimit: jest.fn<IRateLimiterRepository["consumeRateLimit"]>(),
            getRateLimitStatus: jest.fn<IRateLimiterRepository["getRateLimitStatus"]>(),
        };
        useCase = new ConsumeRateLimitUseCase(repository);
    });

    it("should call repository.consumeRateLimit with given count and return true when allowed", async () => {
        repository.consumeRateLimit.mockResolvedValue(true);

        const result = await useCase.execute(5);

        expect(repository.consumeRateLimit).toHaveBeenCalledWith(5);
        expect(result).toBe(true);
    });

    it("should default count to 1 when not provided", async () => {
        repository.consumeRateLimit.mockResolvedValue(true);

        const result = await useCase.execute();

        expect(repository.consumeRateLimit).toHaveBeenCalledWith(1);
        expect(result).toBe(true);
    });

    it("should return false when repository denies tokens", async () => {
        repository.consumeRateLimit.mockResolvedValue(false);

        const result = await useCase.execute(10);

        expect(repository.consumeRateLimit).toHaveBeenCalledWith(10);
        expect(result).toBe(false);
    });

    it("should return true if repository does not implement consumeRateLimit (permissive fallback)", async () => {
        const repoWithoutRateLimit: IRateLimiterRepository =
            {} as unknown as IRateLimiterRepository;
        const permissiveUseCase = new ConsumeRateLimitUseCase(repoWithoutRateLimit);

        const result = await permissiveUseCase.execute(1);

        expect(result).toBe(true);
    });
});
