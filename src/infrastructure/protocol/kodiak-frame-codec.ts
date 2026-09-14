import {
    type IKodiakFrame,
    KODIAK_FRAME_MAGIC,
    KODIAK_HEADER_SIZE,
    type KodiakOpCode,
} from "../../domain/protocol/kodiak-frame.entity.js";

export class KodiakFrameCodec {
    public encode(frame: IKodiakFrame): Uint8Array {
        let headersBytes: Uint8Array | null = null;
        if (frame.headers) {
            headersBytes = new TextEncoder().encode(JSON.stringify(frame.headers));
        } else if (frame.headersRaw && frame.headersRaw.length > 0) {
            headersBytes = frame.headersRaw;
        }

        const headersLen = headersBytes ? headersBytes.length : 0;
        const payloadLen = frame.payload.length;
        const totalSize = KODIAK_HEADER_SIZE + headersLen + payloadLen;

        const buffer = new Uint8Array(totalSize);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

        // Byte 0: Magic
        view.setUint8(0, frame.magic ?? KODIAK_FRAME_MAGIC);
        // Byte 1: Command
        view.setUint8(1, frame.command);
        // Byte 2: Flags
        view.setUint8(2, frame.flags ?? 0);
        // Byte 3: Priority
        view.setUint8(3, frame.priority ?? 0);

        // Bytes 4-19: Message ID (16 bytes)
        this.writeMessageId(view, 4, frame.messageId);

        // Bytes 20-21: Headers Length (2B uint16)
        view.setUint16(20, headersLen, false); // big-endian
        // Bytes 22-25: Payload Length (4B uint32)
        view.setUint32(22, payloadLen, false); // big-endian

        let offset = KODIAK_HEADER_SIZE;
        if (headersBytes && headersLen > 0) {
            buffer.set(headersBytes, offset);
            offset += headersLen;
        }

        if (payloadLen > 0) {
            buffer.set(frame.payload, offset);
        }

        return buffer;
    }

    public decode(buffer: Uint8Array): IKodiakFrame | null {
        if (buffer.length < KODIAK_HEADER_SIZE) {
            return null;
        }

        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const magic = view.getUint8(0);
        if (magic !== KODIAK_FRAME_MAGIC) {
            throw new Error(
                `Invalid Kodiak frame magic: 0x${magic.toString(16)} (expected 0x${KODIAK_FRAME_MAGIC.toString(16)})`,
            );
        }

        const command = view.getUint8(1) as KodiakOpCode;
        const flags = view.getUint8(2);
        const priority = view.getUint8(3);
        const messageId = this.readMessageId(view, 4);
        const headersLength = view.getUint16(20, false);
        const payloadLength = view.getUint32(22, false);

        const totalExpected = KODIAK_HEADER_SIZE + headersLength + payloadLength;
        if (buffer.length < totalExpected) {
            return null; // Truncated frame, wait for more data
        }

        let headersRaw: Uint8Array | undefined;
        let headers: Record<string, string> | undefined;

        if (headersLength > 0) {
            headersRaw = buffer.subarray(KODIAK_HEADER_SIZE, KODIAK_HEADER_SIZE + headersLength);
            try {
                const text = new TextDecoder().decode(headersRaw);
                headers = JSON.parse(text) as Record<string, string>;
            } catch {
                // If not valid JSON, leave as raw
            }
        }

        const payloadOffset = KODIAK_HEADER_SIZE + headersLength;
        // Zero-copy in-place subarray
        const payload = buffer.subarray(payloadOffset, payloadOffset + payloadLength);

        return {
            magic,
            command,
            flags,
            priority,
            messageId,
            headersLength,
            payloadLength,
            headersRaw,
            headers,
            payload,
        };
    }

    private writeMessageId(view: DataView, offset: number, messageId: string): void {
        const hex = messageId.replace(/-/g, "");
        if (hex.length === 32 && /^[0-9a-fA-F]{32}$/.test(hex)) {
            for (let i = 0; i < 16; i++) {
                view.setUint8(offset + i, Number.parseInt(hex.substr(i * 2, 2), 16));
            }
            return;
        }

        // Fallback for non-UUID strings: UTF-8 encoding padded/truncated to 16 bytes
        const encoded = new TextEncoder().encode(messageId);
        for (let i = 0; i < 16; i++) {
            view.setUint8(offset + i, i < encoded.length ? (encoded[i] as number) : 0);
        }
    }

    private readMessageId(view: DataView, offset: number): string {
        const bytes: number[] = [];
        let isZeroPadded = false;
        for (let i = 0; i < 16; i++) {
            const b = view.getUint8(offset + i);
            bytes.push(b);
            if (b === 0) isZeroPadded = true;
        }

        const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

        // If it looks like standard UUID hex
        if (!isZeroPadded) {
            return `${hex.substr(0, 8)}-${hex.substr(8, 4)}-${hex.substr(12, 4)}-${hex.substr(16, 4)}-${hex.substr(20, 12)}`;
        }

        // Check if all bytes are zeroes
        if (bytes.every((b) => b === 0)) {
            return "00000000-0000-0000-0000-000000000000";
        }

        // If it has trailing nulls, decode as text string
        const nonNullBytes = bytes.filter((b) => b !== 0);
        try {
            return new TextDecoder().decode(new Uint8Array(nonNullBytes));
        } catch {
            return hex;
        }
    }
}
