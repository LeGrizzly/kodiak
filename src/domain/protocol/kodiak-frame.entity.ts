export enum KodiakOpCode {
    PUSH = 0x01,
    POLL = 0x02,
    ACK = 0x03,
    NACK = 0x04,
    HEARTBEAT = 0x05,
    CREDIT = 0x06,
    JOB = 0x07,
    ERROR = 0x08,
}

export const KODIAK_FRAME_MAGIC = 0x4b;
export const KODIAK_HEADER_SIZE = 26;

export interface IKodiakFrame {
    magic: number;
    command: KodiakOpCode;
    flags: number;
    priority: number;
    messageId: string;
    headersLength: number;
    payloadLength: number;
    headersRaw?: Uint8Array;
    headers?: Record<string, string>;
    payload: Uint8Array;
}
