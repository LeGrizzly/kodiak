import { Packr } from "msgpackr";
import type { IJobSerializer } from "../../domain/serializers/job-serializer.interface.js";

export class MsgpackJobSerializer implements IJobSerializer {
    private readonly packr: Packr;

    constructor() {
        this.packr = new Packr({
            useRecords: false,
            structuredClone: true,
        });
    }

    public serialize<T>(data: T): Uint8Array {
        return this.packr.pack(data);
    }

    public deserialize<T>(raw: Uint8Array | Buffer | string): T {
        try {
            if (typeof raw === "string") {
                if (raw.startsWith("{") || raw.startsWith("[")) {
                    return JSON.parse(raw) as T;
                }
                const buffer = Buffer.from(raw, "latin1");
                return this.packr.unpack(buffer) as T;
            }
            return this.packr.unpack(raw) as T;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to deserialize job data: ${msg}`);
        }
    }
}
