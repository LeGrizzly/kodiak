import * as net from "node:net";
import {
    KODIAK_FRAME_MAGIC,
    KodiakFrameCodec,
    KodiakOpCode,
    KodiakTcpServer,
    MsgpackJobSerializer,
} from "../src/presentation/index.js";

async function runDemo(): Promise<void> {
    console.log("🐾 Kodiak High-Performance TCP Broker & Binary Framing Demo\n");

    const server = new KodiakTcpServer();
    const port = await server.listen(0);
    console.log(`[Server] Kodiak TCP Server listening on 127.0.0.1:${port}`);

    const codec = new KodiakFrameCodec();
    const serializer = new MsgpackJobSerializer();

    const client = net.createConnection({ port });
    await new Promise<void>((resolve) => client.on("connect", resolve));
    client.setNoDelay(true);
    console.log("[Client] Connected to Kodiak TCP Broker with TCP_NODELAY\n");

    // 1. Prepare typed payload and encode with msgpackr
    const payload = {
        orderId: "ord-8831",
        customer: "developer@kodiak.io",
        amount: 249.99,
        items: [
            { sku: "KODIAK-PERF-1", qty: 2 },
            { sku: "DRAGONFLY-CORE", qty: 1 },
        ],
        timestamp: Date.now(),
    };

    const payloadBytes = serializer.serialize(payload);
    console.log(`[Payload] Serialized payload size (msgpackr): ${payloadBytes.length} bytes`);

    // 2. Encode 26-byte binary frame
    const messageId = "6c84b126-2c9e-4b47-9750-6a9c8e1e7939";
    const pushFrame = codec.encode({
        magic: KODIAK_FRAME_MAGIC,
        command: KodiakOpCode.PUSH,
        flags: 0x01,
        priority: 10,
        messageId,
        headersLength: 0,
        payloadLength: payloadBytes.length,
        headers: { "x-trace-id": "w3c-trace-991823" },
        payload: payloadBytes,
    });

    console.log(`[Client] Sending PUSH binary frame (total size: ${pushFrame.length} bytes)...`);
    client.write(pushFrame);

    // 3. Receive ACK frame
    await new Promise<void>((resolve) => {
        const onAck = (chunk: Buffer) => {
            const decoded = codec.decode(new Uint8Array(chunk));
            if (decoded && decoded.command === KodiakOpCode.ACK) {
                console.log(`[Client] Received ACK for job ID: ${decoded.messageId}`);
                client.removeListener("data", onAck);
                resolve();
            }
        };
        client.on("data", onAck);
    });

    // 4. Send POLL request
    console.log("\n[Client] Sending POLL request...");
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

    // 5. Receive dispatched JOB frame zero-copy
    await new Promise<void>((resolve) => {
        const onJob = (chunk: Buffer) => {
            const decoded = codec.decode(new Uint8Array(chunk));
            if (decoded && decoded.command === KodiakOpCode.JOB) {
                console.log(`[Client] Received JOB frame for ID: ${decoded.messageId}`);
                console.log(`[Client] Headers:`, decoded.headers);

                const receivedPayload = serializer.deserialize(decoded.payload);
                console.log(`[Client] Unpacked job data:`, receivedPayload);

                // Acknowledge completion
                const ackFrame = codec.encode({
                    magic: KODIAK_FRAME_MAGIC,
                    command: KodiakOpCode.ACK,
                    flags: 0,
                    priority: 0,
                    messageId: decoded.messageId,
                    headersLength: 0,
                    payloadLength: 0,
                    payload: new Uint8Array(0),
                });
                client.write(ackFrame);
                console.log(`[Client] Sent final ACK to broker.`);

                client.removeListener("data", onJob);
                resolve();
            }
        };
        client.on("data", onJob);
    });

    client.end();
    await server.close();
    console.log("\n✅ Demo completed successfully and resources closed.");
}

runDemo().catch(console.error);
