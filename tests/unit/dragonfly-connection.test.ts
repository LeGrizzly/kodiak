import { describe, expect, it, jest } from "@jest/globals";
import type { Redis } from "ioredis";
import { DragonflyConnection } from "../../src/infrastructure/dragonfly/dragonfly-connection.js";

describe("DragonflyConnection", () => {
    it("should wrap an existing Redis client instance", async () => {
        const mockDuplicated = {
            duplicate: jest.fn(),
            disconnect: jest.fn(),
            quit: jest.fn().mockResolvedValue("OK" as never),
        } as unknown as Redis;

        const mockClient = {
            duplicate: jest.fn().mockReturnValue(mockDuplicated),
            disconnect: jest.fn(),
            quit: jest.fn().mockResolvedValue("OK" as never),
        } as unknown as Redis;

        const connection = new DragonflyConnection(mockClient);

        expect(connection.getRawClient()).toBe(mockClient);

        const dup = connection.duplicate();
        expect(mockClient.duplicate).toHaveBeenCalledTimes(1);
        expect(dup.getRawClient()).toBe(mockDuplicated);

        connection.disconnect();
        expect(mockClient.disconnect).toHaveBeenCalledTimes(1);

        await connection.quit();
        expect(mockClient.quit).toHaveBeenCalledTimes(1);
    });

    it("should instantiate with RedisOptions and test retryStrategy", async () => {
        const connection = new DragonflyConnection({
            host: "127.0.0.1",
            port: 6379,
            lazyConnect: true,
        });

        const client = connection.getRawClient();
        expect(client).toBeDefined();

        const retryStrategy = client.options.retryStrategy;
        expect(typeof retryStrategy).toBe("function");

        if (typeof retryStrategy === "function") {
            expect(retryStrategy(1)).toBe(100);
            expect(retryStrategy(5)).toBe(500);
            expect(retryStrategy(30)).toBe(2000);
        }

        connection.disconnect();
    });
});
