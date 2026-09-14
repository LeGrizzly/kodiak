import { EventEmitter } from "node:events";
import * as net from "node:net";
import {
    type IKodiakFrame,
    KODIAK_FRAME_MAGIC,
    KODIAK_HEADER_SIZE,
    KodiakOpCode,
} from "../../domain/protocol/kodiak-frame.entity.js";
import { HierarchicalTimingWheel } from "../timing-wheel/hierarchical-timing-wheel.js";
import { KodiakFrameCodec } from "./kodiak-frame-codec.js";

export interface KodiakTcpServerOptions {
    host?: string;
    port?: number;
}

export class KodiakTcpServer extends EventEmitter {
    private readonly server: net.Server;
    private readonly codec = new KodiakFrameCodec();
    private readonly waitingQueue: IKodiakFrame[] = [];
    private readonly timingWheel = new HierarchicalTimingWheel();
    private readonly activeSockets = new Set<net.Socket>();
    private timerInterval: NodeJS.Timeout | null = null;

    constructor() {
        super();
        this.server = net.createServer((socket) => this.handleConnection(socket));
    }

    public async listen(port = 7443, host = "127.0.0.1"): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server.listen(port, host, () => {
                const addr = this.server.address();
                const actualPort = typeof addr === "object" && addr ? addr.port : port;

                this.timerInterval = setInterval(() => {
                    this.timingWheel.advance();
                }, 10);
                if (this.timerInterval && typeof this.timerInterval.unref === "function") {
                    this.timerInterval.unref();
                }

                this.emit("listening", actualPort);
                resolve(actualPort);
            });
            this.server.once("error", reject);
        });
    }

    public async close(): Promise<void> {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        for (const socket of this.activeSockets) {
            socket.destroy();
        }
        this.activeSockets.clear();

        return new Promise((resolve, reject) => {
            this.server.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    private handleConnection(socket: net.Socket): void {
        socket.setNoDelay(true);
        this.activeSockets.add(socket);

        let accumulator = Buffer.alloc(0);

        socket.on("data", (chunk: Buffer) => {
            accumulator = Buffer.concat([accumulator, chunk]);

            while (accumulator.length >= KODIAK_HEADER_SIZE) {
                const frame = this.codec.decode(new Uint8Array(accumulator));
                if (!frame) {
                    break; // Frame is incomplete, wait for next socket chunk
                }

                const frameTotalSize =
                    KODIAK_HEADER_SIZE + frame.headersLength + frame.payloadLength;
                accumulator = accumulator.subarray(frameTotalSize);

                this.processIncomingFrame(socket, frame);
            }
        });

        socket.on("close", () => {
            this.activeSockets.delete(socket);
        });

        socket.on("error", (err) => {
            this.emit("clientError", err);
            this.activeSockets.delete(socket);
        });
    }

    private processIncomingFrame(socket: net.Socket, frame: IKodiakFrame): void {
        switch (frame.command) {
            case KodiakOpCode.PUSH: {
                this.waitingQueue.push(frame);
                this.emit("push", frame);

                const ackFrame = this.codec.encode({
                    magic: KODIAK_FRAME_MAGIC,
                    command: KodiakOpCode.ACK,
                    flags: 0,
                    priority: frame.priority,
                    messageId: frame.messageId,
                    headersLength: 0,
                    payloadLength: 0,
                    payload: new Uint8Array(0),
                });
                socket.write(ackFrame);
                break;
            }

            case KodiakOpCode.POLL: {
                const nextJob = this.waitingQueue.shift();
                if (nextJob) {
                    const jobFrame = this.codec.encode({
                        magic: KODIAK_FRAME_MAGIC,
                        command: KodiakOpCode.JOB,
                        flags: nextJob.flags,
                        priority: nextJob.priority,
                        messageId: nextJob.messageId,
                        headersLength: nextJob.headersLength,
                        payloadLength: nextJob.payloadLength,
                        headersRaw: nextJob.headersRaw,
                        headers: nextJob.headers,
                        payload: nextJob.payload,
                    });
                    socket.write(jobFrame);
                    this.emit("poll", nextJob);
                } else {
                    // Queue empty: reply with NACK or empty ACK
                    const emptyFrame = this.codec.encode({
                        magic: KODIAK_FRAME_MAGIC,
                        command: KodiakOpCode.NACK,
                        flags: 0,
                        priority: 0,
                        messageId: frame.messageId,
                        headersLength: 0,
                        payloadLength: 0,
                        payload: new Uint8Array(0),
                    });
                    socket.write(emptyFrame);
                }
                break;
            }

            case KodiakOpCode.ACK: {
                this.emit("ack", frame.messageId);
                break;
            }

            case KodiakOpCode.HEARTBEAT: {
                const pongFrame = this.codec.encode({
                    magic: KODIAK_FRAME_MAGIC,
                    command: KodiakOpCode.HEARTBEAT,
                    flags: 0,
                    priority: 0,
                    messageId: frame.messageId,
                    headersLength: 0,
                    payloadLength: 0,
                    payload: new Uint8Array(0),
                });
                socket.write(pongFrame);
                break;
            }

            default:
                break;
        }
    }
}
