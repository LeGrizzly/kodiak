import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { MsgpackJobSerializer } from "../../src/infrastructure/serializers/msgpack-job.serializer.js";

describe("MsgpackJobSerializer", () => {
    let serializer: MsgpackJobSerializer;

    beforeEach(() => {
        serializer = new MsgpackJobSerializer();
    });

    it("should serialize and deserialize primitive values", () => {
        const str = "hello kodiak";
        const num = 42.5;
        const bool = true;

        expect(serializer.deserialize(serializer.serialize(str))).toBe(str);
        expect(serializer.deserialize(serializer.serialize(num))).toBe(num);
        expect(serializer.deserialize(serializer.serialize(bool))).toBe(bool);
    });

    it("should serialize and deserialize complex nested objects and arrays", () => {
        const payload = {
            orderId: "ord-9876",
            amount: 149.99,
            tags: ["express", "priority", "fragile"],
            customer: {
                id: 12345,
                email: "dev@kodiak.io",
                verified: true,
            },
            meta: {
                attempts: 1,
                source: "api-gateway",
            },
        };

        const serialized = serializer.serialize(payload);
        expect(serialized).toBeInstanceOf(Uint8Array);

        const deserialized = serializer.deserialize<typeof payload>(serialized);
        expect(deserialized).toEqual(payload);
    });

    it("should handle buffer / Uint8Array inputs in deserialize", () => {
        const data = { message: "direct buffer" };
        const buffer = serializer.serialize(data);
        const nodeBuffer = Buffer.from(buffer);

        expect(serializer.deserialize<typeof data>(nodeBuffer)).toEqual(data);
    });

    it("should produce a more compact binary representation than JSON", () => {
        const payload = {
            id: "uuid-550e8400-e29b-41d4-a716-446655440000",
            title: "Process payment invoice",
            amount: 12500,
            currency: "EUR",
            items: [
                { sku: "SKU-001", quantity: 2, price: 5000 },
                { sku: "SKU-002", quantity: 1, price: 2500 },
            ],
            createdAt: "2026-09-14T20:00:00.000Z",
        };

        const msgpackBuffer = serializer.serialize(payload);
        const jsonString = JSON.stringify(payload);
        const jsonByteLength = Buffer.byteLength(jsonString, "utf8");

        expect(msgpackBuffer.length).toBeLessThan(jsonByteLength);
    });

    it("should throw an error on corrupted / unparseable payload", () => {
        const corrupted = new Uint8Array([0x81]); // fixmap with 1 entry, but truncated (missing key/value)

        expect(() => serializer.deserialize(corrupted)).toThrow(/Failed to deserialize job data/);
    });

    it("should handle non-Error thrown during deserialization", () => {
        const packr = (serializer as unknown as { packr: { unpack: () => unknown } }).packr;
        jest.spyOn(packr, "unpack").mockImplementationOnce(() => {
            throw "non-error-string";
        });

        expect(() => serializer.deserialize(new Uint8Array([1, 2, 3]))).toThrow(
            "Failed to deserialize job data: non-error-string",
        );
    });

    it("should deserialize raw JSON string object and array", () => {
        expect(serializer.deserialize('{"key":"val"}')).toEqual({ key: "val" });
        expect(serializer.deserialize('[1, 2, "three"]')).toEqual([1, 2, "three"]);
    });

    it("should deserialize latin1 encoded msgpack binary string", () => {
        const data = { hello: "world" };
        const packed = serializer.serialize(data);
        const latin1String = Buffer.from(packed).toString("latin1");

        expect(serializer.deserialize(latin1String)).toEqual(data);
    });
});
