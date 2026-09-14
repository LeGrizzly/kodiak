import * as net from "node:net";
import { describe, expect, it } from "@jest/globals";
import { KODIAK_FRAME_MAGIC, KodiakOpCode } from "../../src/domain/protocol/kodiak-frame.entity.js";
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
});
