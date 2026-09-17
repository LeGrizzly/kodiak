import { describe, expect, it } from "vitest";
import { task } from "../../src/presentation/task.js";

describe("task helper", () => {
    it("should return the provided task definition unmodified", () => {
        interface EmailData {
            to: string;
            subject: string;
        }

        const emailTask = task<EmailData>({
            name: "send-email",
            options: { priority: 1, attempts: 3 },
            schema: (input: unknown) => input as EmailData,
        });

        expect(emailTask.name).toBe("send-email");
        expect(emailTask.options).toEqual({ priority: 1, attempts: 3 });
        expect(typeof emailTask.schema).toBe("function");
    });
});
