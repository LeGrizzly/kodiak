import { describe, expect, it, jest } from "@jest/globals";
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
            command: KodiakOpCode.ACK,
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

    it("should encode with headersRaw when headers object is omitted", () => {
        const raw = new TextEncoder().encode('{"raw":true}');
        const encoded = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            flags: 0,
            priority: 0,
            command: KodiakOpCode.JOB,
            messageId: "11111111-2222-3333-4444-555555555555",
            headersLength: raw.length,
            payloadLength: 0,
            headersRaw: raw,
            payload: new Uint8Array(0),
        });

        const decoded = codec.decode(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded?.headers).toEqual({ raw: true });
    });

    it("should return null when frame buffer contains complete header but truncated payload", () => {
        const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const encoded = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            flags: 0,
            priority: 0,
            command: KodiakOpCode.PUSH,
            messageId: "00000000-0000-0000-0000-000000000001",
            headersLength: 0,
            payloadLength: payload.length,
            payload,
        });

        // Slice to truncate payload but leave header intact
        const truncated = encoded.subarray(0, KODIAK_HEADER_SIZE + 2);
        expect(codec.decode(truncated)).toBeNull();
    });

    it("should encode and decode non-UUID message IDs with UTF-8 fallback", () => {
        const customId = "short-id";
        const encoded = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            flags: 0,
            priority: 0,
            command: KodiakOpCode.ACK,
            messageId: customId,
            headersLength: 0,
            payloadLength: 0,
            payload: new Uint8Array(0),
        });

        const decoded = codec.decode(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded?.messageId).toBe(customId);
    });

    it("should decode all-zeroes messageId as all-zeroes UUID string", () => {
        const buffer = new Uint8Array(KODIAK_HEADER_SIZE);
        buffer[0] = KODIAK_FRAME_MAGIC;
        buffer[1] = KodiakOpCode.ACK;

        const decoded = codec.decode(buffer);
        expect(decoded).not.toBeNull();
        expect(decoded?.messageId).toBe("00000000-0000-0000-0000-000000000000");
    });

    it("should keep raw headers when headers are not valid JSON", () => {
        const malformedRaw = new Uint8Array([0x7b, 0x22, 0x61, 0x3a]); // '{ "a:' (invalid JSON)
        const encoded = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            flags: 0,
            priority: 0,
            command: KodiakOpCode.PUSH,
            messageId: "11111111-2222-3333-4444-555555555555",
            headersLength: malformedRaw.length,
            payloadLength: 0,
            headersRaw: malformedRaw,
            payload: new Uint8Array(0),
        });

        const decoded = codec.decode(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded?.headers).toBeUndefined();
        expect(decoded?.headersRaw).toEqual(malformedRaw);
    });

    it("should fallback to hex string if decoding non-UUID message ID throws", () => {
        const buffer = new Uint8Array(KODIAK_HEADER_SIZE);
        buffer[0] = KODIAK_FRAME_MAGIC;
        buffer[1] = KodiakOpCode.ACK;
        buffer[4] = 0x41; // 'A'
        buffer[5] = 0x00; // trailing null

        const decodeSpy = jest.spyOn(TextDecoder.prototype, "decode").mockImplementationOnce(() => {
            throw new Error("TextDecoder failed");
        });

        const decoded = codec.decode(buffer);
        expect(decoded).not.toBeNull();
        expect(typeof decoded?.messageId).toBe("string");
        decodeSpy.mockRestore();
    });
});
