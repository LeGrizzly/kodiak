import { describe, expect, it } from "@jest/globals";
import {
    KODIAK_FRAME_MAGIC,
    KODIAK_HEADER_SIZE,
    KodiakOpCode,
} from "../../src/domain/protocol/kodiak-frame.entity.js";
import { KodiakFrameCodec } from "../../src/infrastructure/protocol/kodiak-frame-codec.js";

describe("KodiakFrameCodec", () => {
    const codec = new KodiakFrameCodec();

    it("should encode and decode a frame with payload and headers", () => {
        const payload = new TextEncoder().encode("hello high performance kodiak");
        const headers = { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" };
        const messageId = "6c84b126-2c9e-4b47-9750-6a9c8e1e7939";

        const encoded = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            command: KodiakOpCode.PUSH,
            flags: 0x01,
            priority: 5,
            messageId,
            headersLength: 0,
            payloadLength: payload.length,
            headers,
            payload,
        });

        expect(encoded).toBeInstanceOf(Uint8Array);
        expect(encoded.length).toBeGreaterThanOrEqual(KODIAK_HEADER_SIZE + payload.length);
        expect(encoded[0]).toBe(KODIAK_FRAME_MAGIC);
        expect(encoded[1]).toBe(KodiakOpCode.PUSH);

        const decoded = codec.decode(encoded);
        expect(decoded).not.toBeNull();
        if (!decoded) return;

        expect(decoded.magic).toBe(KODIAK_FRAME_MAGIC);
        expect(decoded.command).toBe(KodiakOpCode.PUSH);
        expect(decoded.flags).toBe(0x01);
        expect(decoded.priority).toBe(5);
        expect(decoded.messageId).toBe(messageId);
        expect(decoded.headers).toEqual(headers);
        expect(new TextDecoder().decode(decoded.payload)).toBe("hello high performance kodiak");
    });

    it("should encode and decode a frame without headers", () => {
        const payload = new Uint8Array([1, 2, 3, 4, 5]);
        const messageId = "00000000-0000-0000-0000-000000000001";

        const encoded = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            command: KodiakOpCode.ACK,
            flags: 0,
            priority: 0,
            messageId,
            headersLength: 0,
            payloadLength: payload.length,
            payload,
        });

        expect(encoded.length).toBe(KODIAK_HEADER_SIZE + payload.length);

        const decoded = codec.decode(encoded);
        expect(decoded).not.toBeNull();
        if (!decoded) return;

        expect(decoded.command).toBe(KodiakOpCode.ACK);
        expect(decoded.headersLength).toBe(0);
        expect(decoded.payload).toEqual(payload);
    });

    it("should reject frames with invalid magic byte", () => {
        const buffer = new Uint8Array(KODIAK_HEADER_SIZE);
        buffer[0] = 0xff; // Invalid magic byte

        expect(() => codec.decode(buffer)).toThrow(/Invalid Kodiak frame magic/);
    });

    it("should return null or throw on truncated frames", () => {
        const truncated = new Uint8Array(10); // Less than header size
        expect(codec.decode(truncated)).toBeNull();
    });

    it("should support zero-copy payload extraction", () => {
        const payload = new Uint8Array([10, 20, 30, 40, 50]);
        const encoded = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            command: KodiakOpCode.POLL,
            flags: 0,
            priority: 1,
            messageId: "11111111-2222-3333-4444-555555555555",
            headersLength: 0,
            payloadLength: payload.length,
            payload,
        });

        const decoded = codec.decode(encoded);
        expect(decoded).not.toBeNull();
        if (!decoded) return;

        // Verify that payload buffer shares memory with the encoded buffer
        expect(decoded.payload.buffer).toBe(encoded.buffer);
    });
});
