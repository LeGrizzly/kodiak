import type { IQueueRepository } from "../domain/repositories/queue.repository.js";

export class WorkerHeartbeatManager<T> {
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly repository: IQueueRepository<T>,
        private readonly lockDuration: number,
        private readonly interval: number,
        private readonly onError: (error: unknown) => void,
    ) {}

    public start(jobId: string, ownerToken: string): void {
        this.stop();
        this.timer = setInterval(async () => {
            try {
                await this.repository.extendLock(jobId, Date.now() + this.lockDuration, ownerToken);
            } catch (error) {
                this.onError(error);
            }
        }, this.interval);

        this.timer.unref();
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
