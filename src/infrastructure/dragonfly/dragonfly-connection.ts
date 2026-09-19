import { Redis, type RedisOptions } from "ioredis";

export interface IConnection {
    getRawClient(): Redis;
    duplicate(): IConnection;
    disconnect(): void;
    quit(): Promise<void>;
}

export class DragonflyConnection implements IConnection {
    private readonly client: Redis;

    constructor(clientOrOptions: Redis | RedisOptions) {
        if ("duplicate" in clientOrOptions && typeof clientOrOptions.duplicate === "function") {
            this.client = clientOrOptions as Redis;
        } else {
            const defaults: Partial<RedisOptions> = {
                maxRetriesPerRequest: null,
                retryStrategy: (times: number) => Math.min(100 * times, 2000),
                enableOfflineQueue: true,
                connectTimeout: 10000,
                noDelay: true,
                keepAlive: 30000,
            };
            const merged = { ...defaults, ...(clientOrOptions as RedisOptions) } as RedisOptions;
            this.client = new Redis(merged);
        }
    }

    public getRawClient(): Redis {
        return this.client;
    }

    public duplicate(): IConnection {
        return new DragonflyConnection(this.client.duplicate());
    }

    public disconnect(): void {
        this.client.disconnect();
    }

    public async quit(): Promise<void> {
        await this.client.quit();
    }
}
