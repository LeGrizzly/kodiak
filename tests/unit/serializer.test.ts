import { describe, expect, it } from "@jest/globals";
import { MsgpackJobSerializer } from "../../src/infrastructure/serializers/msgpack-job.serializer.js";

describe("MsgpackJobSerializer", () => {
    const serializer = new MsgpackJobSerializer();

    it("should serialize and deserialize primitive values", () => {
        expect(serializer.deserialize(serializer.serialize("hello"))).toBe("hello");
        expect(serializer.deserialize(serializer.serialize(12345))).toBe(12345);
        expect(serializer.deserialize(serializer.serialize(true))).toBe(true);
        expect(serializer.deserialize(serializer.serialize(null))).toBeNull();
    });

    it("should serialize and deserialize complex objects", () => {
        interface ComplexPayload {
            user: { id: string; roles: string[] };
            metadata: Record<string, number>;
        }

        const data: ComplexPayload = {
            user: { id: "usr-123", roles: ["admin", "editor"] },
            metadata: { score: 99.5, retries: 2 },
        };

        const serialized = serializer.serialize(data);
        expect(serialized).toBeInstanceOf(Uint8Array);

        const deserialized = serializer.deserialize<ComplexPayload>(serialized);
        expect(deserialized).toEqual(data);
    });

    it("should throw a friendly error when deserializing invalid data", () => {
        const truncated = new Uint8Array([0x81]);
        expect(() => serializer.deserialize(truncated)).toThrow(/Failed to deserialize job data/);
    });
});
