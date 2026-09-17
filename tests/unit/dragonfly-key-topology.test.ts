import { describe, expect, it } from "vitest";
import { DragonflyKeyTopology } from "../../src/infrastructure/dragonfly/dragonfly-key-topology.js";

describe("DragonflyKeyTopology", () => {
    it("should construct key topologies with hashtag for single-shard affinity", () => {
        const topology = new DragonflyKeyTopology("kodiak", "orders");

        expect(topology.prefix).toBe("kodiak");
        expect(topology.queueName).toBe("orders");
        expect(topology.waitingKey).toBe("{kodiak:orders}:waiting");
        expect(topology.activeKey).toBe("{kodiak:orders}:active");
        expect(topology.delayedKey).toBe("{kodiak:orders}:delayed");
        expect(topology.notifyKey).toBe("{kodiak:orders}:notify");
        expect(topology.deadKey).toBe("{kodiak:orders}:dead");
        expect(topology.rateLimitKey).toBe("{kodiak:orders}:ratelimit");
        expect(topology.jobKeyPrefix).toBe("{kodiak:orders}:jobs:");
        expect(topology.jobKey("job-123")).toBe("{kodiak:orders}:jobs:job-123");
    });
});
