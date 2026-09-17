import { type Mocked, vi } from "vitest";
import { UpdateJobProgressUseCase } from "../../src/application/use-cases/update-job-progress.use-case.js";
import type { IQueueRepository } from "../../src/domain/repositories/queue.repository.js";

describe("UpdateJobProgressUseCase", () => {
    let updateJobProgressUseCase: UpdateJobProgressUseCase<unknown>;
    let mockQueueRepository: Mocked<IQueueRepository<unknown>>;

    beforeEach(() => {
        mockQueueRepository = {
            add: vi.fn(),
            fetchNext: vi.fn(),
            markAsCompleted: vi.fn(),
            markAsFailed: vi.fn(),
            updateProgress: vi
                .fn<IQueueRepository<unknown>["updateProgress"]>()
                .mockResolvedValue(undefined as never),
        } as unknown as Mocked<IQueueRepository<unknown>>;
        updateJobProgressUseCase = new UpdateJobProgressUseCase(mockQueueRepository);
    });

    it("should call updateProgress on the repository", async () => {
        await updateJobProgressUseCase.execute("job-123", 50);

        expect(mockQueueRepository.updateProgress).toHaveBeenCalledWith("job-123", 50);
    });
});
