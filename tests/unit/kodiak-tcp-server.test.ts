import * as net from "node:net";
import { describe, expect, it, type Mock, vi } from "vitest";
import {
    type IKodiakFrame,
    KODIAK_FRAME_MAGIC,
    KodiakOpCode,
} from "../../src/domain/protocol/kodiak-frame.entity.js";
import { KodiakFrameCodec } from "../../src/infrastructure/protocol/kodiak-frame-codec.js";
import { KodiakTcpServer } from "../../src/infrastructure/protocol/kodiak-tcp-server.js";
import { MsgpackJobSerializer } from "../../src/infrastructure/serializers/msgpack-job.serializer.js";

describe("Integration: KodiakTcpServer", () => {
    const codec = new KodiakFrameCodec();
    const serializer = new MsgpackJobSerializer();

    it("should accept PUSH and respond with ACK over TCP", async () => {
        const server = new KodiakTcpServer();
        const port = await server.listen(0);

        const client = net.createConnection({ port }, () => {
            const payload = serializer.serialize({ orderId: "ord-101", amount: 250 });
            const pushFrame = codec.encode({
                magic: KODIAK_FRAME_MAGIC,
                command: KodiakOpCode.PUSH,
                flags: 0,
                priority: 1,
                messageId: "12345678-1234-1234-1234-123456789abc",
                headersLength: 0,
                payloadLength: payload.length,
                payload,
            });
            client.write(pushFrame);
        });

        const ackPromise = new Promise<void>((resolve, reject) => {
            let buffer = Buffer.alloc(0);
            client.on("data", (chunk: Buffer) => {
                buffer = Buffer.concat([buffer, chunk]);
                const decoded = codec.decode(
                    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length),
                );
                if (decoded) {
                    try {
                        expect(decoded.command).toBe(KodiakOpCode.ACK);
                        expect(decoded.messageId).toBe("12345678-1234-1234-1234-123456789abc");
                        client.end();
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                }
            });
            client.on("error", reject);
        });

        await ackPromise;
        await server.close();
    });

    it("should allow PUSH then POLL to receive a queued job over TCP", async () => {
        const server = new KodiakTcpServer();
        const port = await server.listen(0);

        const client = net.createConnection({ port });
        const receivedJobs: unknown[] = [];

        await new Promise<void>((resolve) => client.on("connect", resolve));

        // 1. PUSH a job
        const payloadData = { task: "email-welcome", to: "user@example.com" };
        const payloadBytes = serializer.serialize(payloadData);
        const pushFrame = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            command: KodiakOpCode.PUSH,
            flags: 0,
            priority: 5,
            messageId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            headersLength: 0,
            payloadLength: payloadBytes.length,
            payload: payloadBytes,
        });

        client.write(pushFrame);

        // 2. Read ACK, then send POLL
        await new Promise<void>((resolve, reject) => {
            const onData = (chunk: Buffer) => {
                const decoded = codec.decode(
                    new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length),
                );
                if (decoded && decoded.command === KodiakOpCode.ACK) {
                    client.removeListener("data", onData);
                    // Send POLL
                    const pollFrame = codec.encode({
                        magic: KODIAK_FRAME_MAGIC,
                        command: KodiakOpCode.POLL,
                        flags: 0,
                        priority: 0,
                        messageId: "00000000-0000-0000-0000-000000000000",
                        headersLength: 0,
                        payloadLength: 0,
                        payload: new Uint8Array(0),
                    });
                    client.write(pollFrame);
                    resolve();
                }
            };
            client.on("data", onData);
            client.on("error", reject);
        });

        // 3. Receive the JOB frame
        await new Promise<void>((resolve, reject) => {
            const onJob = (chunk: Buffer) => {
                const decoded = codec.decode(
                    new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length),
                );
                if (decoded && decoded.command === KodiakOpCode.JOB) {
                    const parsed = serializer.deserialize(decoded.payload);
                    receivedJobs.push(parsed);
                    client.removeListener("data", onJob);
                    client.end();
                    resolve();
                }
            };
            client.on("data", onJob);
            client.on("error", reject);
        });

        expect(receivedJobs).toHaveLength(1);
        expect(receivedJobs[0]).toEqual(payloadData);

        await server.close();
    });

    it("should respond with NACK when client polls an empty queue", async () => {
        const server = new KodiakTcpServer();
        const port = await server.listen(0);

        const client = net.createConnection({ port });
        await new Promise<void>((resolve) => client.on("connect", resolve));

        const nackPromise = new Promise<IKodiakFrame>((resolve, reject) => {
            client.on("data", (chunk: Buffer | string) => {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                const decoded = codec.decode(
                    new Uint8Array(buf.buffer, buf.byteOffset, buf.length),
                );
                if (decoded) {
                    client.end();
                    resolve(decoded);
                }
            });
            client.on("error", reject);
        });

        const pollFrame = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            flags: 0,
            priority: 0,
            command: KodiakOpCode.POLL,
            messageId: "12345678-1234-1234-1234-123456789abc",
            headersLength: 0,
            payloadLength: 0,
            payload: new Uint8Array(0),
        });
        client.write(pollFrame);

        const response = await nackPromise;
        expect(response.command).toBe(KodiakOpCode.NACK);
        expect(response.messageId).toBe("12345678-1234-1234-1234-123456789abc");

        await server.close();
    });

    it("should emit ack event on incoming ACK frame", async () => {
        const server = new KodiakTcpServer();
        const port = await server.listen(0);

        const client = net.createConnection({ port });
        await new Promise<void>((resolve) => client.on("connect", resolve));

        const ackMsgId = "22222222-3333-4444-5555-666666666666";
        const ackPromise = new Promise<string>((resolve) => {
            server.once("ack", resolve);
        });

        const ackFrame = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            flags: 0,
            priority: 0,
            command: KodiakOpCode.ACK,
            messageId: ackMsgId,
            headersLength: 0,
            payloadLength: 0,
            payload: new Uint8Array(0),
        });
        client.write(ackFrame);

        const receivedId = await ackPromise;
        expect(receivedId).toBe(ackMsgId);

        client.end();
        await server.close();
    });

    it("should respond with HEARTBEAT frame on incoming HEARTBEAT command", async () => {
        const server = new KodiakTcpServer();
        const port = await server.listen(0);

        const client = net.createConnection({ port });
        await new Promise<void>((resolve) => client.on("connect", resolve));

        const heartbeatMsgId = "33333333-4444-5555-6666-777777777777";
        const pongPromise = new Promise<IKodiakFrame>((resolve, reject) => {
            client.on("data", (chunk: Buffer | string) => {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                const decoded = codec.decode(
                    new Uint8Array(buf.buffer, buf.byteOffset, buf.length),
                );
                if (decoded) {
                    client.end();
                    resolve(decoded);
                }
            });
            client.on("error", reject);
        });

        const heartbeatFrame = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            flags: 0,
            priority: 0,
            command: KodiakOpCode.HEARTBEAT,
            messageId: heartbeatMsgId,
            headersLength: 0,
            payloadLength: 0,
            payload: new Uint8Array(0),
        });
        client.write(heartbeatFrame);

        const pong = await pongPromise;
        expect(pong.command).toBe(KodiakOpCode.HEARTBEAT);
        expect(pong.messageId).toBe(heartbeatMsgId);

        await server.close();
    });

    it("should handle partial chunk buffering and default opcode gracefully", async () => {
        const server = new KodiakTcpServer();
        const port = await server.listen(0);

        const client = net.createConnection({ port });
        await new Promise<void>((resolve) => client.on("connect", resolve));

        // Create a frame with 20 bytes payload and unknown opcode 0xfe
        const customPayload = new Uint8Array(20).fill(1);
        const customFrame = codec.encode({
            magic: KODIAK_FRAME_MAGIC,
            flags: 0,
            priority: 0,
            command: 0xfe as KodiakOpCode,
            messageId: "44444444-5555-6666-7777-888888888888",
            headersLength: 0,
            payloadLength: customPayload.length,
            payload: customPayload,
        });

        // Frame total length = 26 (header) + 20 (payload) = 46.
        // Send 30 bytes first: accumulator length >= 26, but < 46.
        // This causes codec.decode to return null, triggering line 81 break!
        const part1 = customFrame.subarray(0, 30);
        const part2 = customFrame.subarray(30);

        client.write(part1);
        await new Promise((r) => setTimeout(r, 20));
        // Send remainder with unknown opcode (tests line 177 default break)
        client.write(part2);
        await new Promise((r) => setTimeout(r, 20));

        client.end();
        await server.close();
    });

    it("should emit clientError on socket error and handle close errors", async () => {
        const server = new KodiakTcpServer();
        const port = await server.listen(0);

        const errorPromise = new Promise<Error>((resolve) => {
            server.once("clientError", resolve);
        });

        const underlyingServer = (server as unknown as { server: net.Server }).server;
        let serverSideSocket: net.Socket | undefined;
        underlyingServer.once("connection", (sock) => {
            serverSideSocket = sock;
        });

        const client = net.createConnection({ port });
        await new Promise<void>((resolve) => client.on("connect", resolve));
        client.on("error", () => {});

        while (!serverSideSocket) {
            await new Promise((r) => setTimeout(r, 5));
        }

        serverSideSocket.emit("error", new Error("Server socket simulated error"));

        const clientErr = await errorPromise;
        expect(clientErr.message).toBe("Server socket simulated error");

        client.end();
        await server.close();

        // Closing an already closed server should reject
        await expect(server.close()).rejects.toThrow();
    });

    it("should handle default host and timer interval tick during listen", async () => {
        const server = new KodiakTcpServer();
        // Call listen with port 0 and default host
        const port = await server.listen(0);
        expect(port).toBeGreaterThan(0);

        // Wait for setInterval (10ms) to execute timingWheel.advance()
        await new Promise((r) => setTimeout(r, 30));

        await server.close();
    });

    it("should reject listen if server emits error", async () => {
        const server1 = new KodiakTcpServer();
        const port = await server1.listen(0);

        const server2 = new KodiakTcpServer();
        // Listening on the same port should throw EADDRINUSE
        await expect(server2.listen(port)).rejects.toThrow();

        await server1.close();
    });

    it("should fallback to given port if address is not an object", async () => {
        const server = new KodiakTcpServer();
        const underlyingServer = (server as unknown as { server: net.Server }).server;
        vi.spyOn(underlyingServer, "address").mockReturnValueOnce("pipe-address" as never);

        const port = await server.listen(0);
        expect(port).toBe(0);

        await server.close();
    });

    it("should use default port 7443 and host 127.0.0.1 when listen has no arguments", async () => {
        const server = new KodiakTcpServer();
        const underlyingServer = (server as unknown as { server: net.Server }).server;
        const listenSpy = vi
            .spyOn(underlyingServer, "listen")
            .mockImplementation((...args: unknown[]) => {
                const cb = args.find((a) => typeof a === "function") as () => void;
                if (cb) cb();
                return underlyingServer;
            });
        const closeSpy = vi.spyOn(underlyingServer, "close").mockImplementation((cb?: unknown) => {
            const callback = cb as (err?: Error) => void;
            if (callback) callback();
            return underlyingServer;
        });

        const port = await server.listen();
        expect(port).toBe(7443);
        expect(listenSpy as unknown as Mock).toHaveBeenCalledWith(
            7443,
            "127.0.0.1",
            expect.any(Function),
        );

        await server.close();
        listenSpy.mockRestore();
        closeSpy.mockRestore();
    });

    it("should handle timerInterval without unref method", async () => {
        const server = new KodiakTcpServer();
        const intervalSpy = vi
            .spyOn(global, "setInterval")
            .mockReturnValueOnce(999 as unknown as NodeJS.Timeout);

        const port = await server.listen(0);
        expect(port).toBeGreaterThan(0);

        await server.close();
        intervalSpy.mockRestore();
    });
});
