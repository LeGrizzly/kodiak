/**
 * Manages key topologies for DragonflyDB queues.
 * Enforces the `{prefix:queue}` hashtag so that all keys belonging to the same queue
 * reside on the same thread/shard in DragonflyDB's Shared-Nothing architecture.
 */
export class DragonflyKeyTopology {
    private readonly hashtag: string;

    constructor(
        public readonly prefix: string,
        public readonly queueName: string,
    ) {
        this.hashtag = `{${prefix}:${queueName}}`;
    }

    public get waitingKey(): string {
        return `${this.hashtag}:waiting`;
    }

    public get activeKey(): string {
        return `${this.hashtag}:active`;
    }

    public get delayedKey(): string {
        return `${this.hashtag}:delayed`;
    }

    public get notifyKey(): string {
        return `${this.hashtag}:notify`;
    }

    public get deadKey(): string {
        return `${this.hashtag}:dead`;
    }

    public get rateLimitKey(): string {
        return `${this.hashtag}:ratelimit`;
    }

    public get jobKeyPrefix(): string {
        return `${this.hashtag}:jobs:`;
    }

    public jobKey(jobId: string): string {
        return `${this.hashtag}:jobs:${jobId}`;
    }
}
