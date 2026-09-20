/**
 * Error thrown when a job with an active deduplication key already exists
 * and the deduplication strategy is set to "throw".
 */
export class JobAlreadyExistsError extends Error {
    constructor(
        public readonly jobId: string,
        public readonly deduplicationId: string,
        message = `Job with deduplication id "${deduplicationId}" already exists (existing job: "${jobId}")`,
    ) {
        super(message);
        this.name = "JobAlreadyExistsError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
