import { describe, expect, it } from "vitest";
import { jobOptions } from "../../src/application/dtos/job-options.builder.js";
import { TaskBuilder, task } from "../../src/presentation/task.js";

describe("task helper and TaskBuilder", () => {
    interface EmailData {
        to: string;
        subject: string;
    }

    it("should initialize task with name and schema and configure parameters via builder", () => {
        const emailTask = task<EmailData>({
            name: "send-email",
            schema: (input: unknown) => input as EmailData,
        })
            .priority(1)
            .attempts(3);

        expect(emailTask.name).toBe("send-email");
        expect(emailTask.options).toEqual({ priority: 1, attempts: 3 });
        expect(typeof emailTask.schema).toBe("function");
    });

    it("should support fluent chaining from object declaration (user syntax)", () => {
        const welcomeEmailTask = task<EmailData>({
            name: "welcome-email",
        })
            .attempts(3)
            .backoff("exponential", 1000);

        expect(welcomeEmailTask).toBeInstanceOf(TaskBuilder);
        expect(welcomeEmailTask.name).toBe("welcome-email");
        expect(welcomeEmailTask.options).toEqual({
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
        });
    });

    it("should support string name shorthand declaration", () => {
        const orderTask = task<{ orderId: string }>("process-order")
            .priority(5)
            .delay(1000)
            .attempts(2);

        expect(orderTask.name).toBe("process-order");
        expect(orderTask.options).toEqual({
            priority: 5,
            delay: 1000,
            attempts: 2,
        });
    });

    it("should support backoff and repeat overloads", () => {
        const task1 = task("t1").backoff({ type: "fixed", delay: 2000 });
        expect(task1.options?.backoff).toEqual({ type: "fixed", delay: 2000 });

        // Test backoff with omitted delay defaulting to 0
        const taskNoDelay = (
            task("t-no-delay") as unknown as {
                backoff: (type: string) => TaskBuilder<unknown>;
            }
        ).backoff("fixed");
        expect(taskNoDelay.options?.backoff).toEqual({ type: "fixed", delay: 0 });

        const task2 = task("t2").repeat(60000, 5);
        expect(task2.options?.repeat).toEqual({ every: 60000, limit: 5 });

        const task3 = task("t3").repeat({ every: 30000 });
        expect(task3.options?.repeat).toEqual({ every: 30000 });
    });

    it("should support deduplication, lifecycle, and tracing flags", () => {
        const scheduled = new Date("2026-10-01T00:00:00Z");
        const configured = task("heavy-task")
            .waitUntil(scheduled)
            .deduplicate({ ttl: 30000, strategy: "ignore-if-exists" })
            .removeOnSuccess()
            .removeOnFailure(false)
            .traceparent("00-test-trace-01");

        expect(configured.options).toEqual({
            waitUntil: scheduled,
            deduplication: { ttl: 30000, strategy: "ignore-if-exists" },
            removeOnSuccess: true,
            removeOnFailure: false,
            traceparent: "00-test-trace-01",
        });

        const booleanDedup = task("simple").deduplication(true);
        expect(booleanDedup.options?.deduplication).toBe(true);

        const defaultFlags = task("defaults").deduplicate().removeOnSuccess().removeOnFailure();
        expect(defaultFlags.options?.deduplication).toBe(true);
        expect(defaultFlags.options?.removeOnSuccess).toBe(true);
        expect(defaultFlags.options?.removeOnFailure).toBe(true);
    });

    it("should be immutable and allow safe task derivation", () => {
        const baseTask = task<EmailData>("send-email").attempts(3);
        const urgentTask = baseTask.priority(10);
        const delayedTask = baseTask.delay(5000);

        expect(baseTask.options).toEqual({ attempts: 3 });
        expect(urgentTask.options).toEqual({ attempts: 3, priority: 10 });
        expect(delayedTask.options).toEqual({ attempts: 3, delay: 5000 });
    });

    it("should support schema attachment via withSchema and validate, and .build() / .toDefinition()", () => {
        const schemaFn = (input: unknown) => input as EmailData;
        const taskWithSchema = task<EmailData>("email-task").withSchema(schemaFn).attempts(2);

        expect(taskWithSchema.schema).toBe(schemaFn);

        const taskWithValidate = task<EmailData>("email-task-2").validate(schemaFn);
        expect(taskWithValidate.schema).toBe(schemaFn);

        const def1 = taskWithSchema.build();
        const def2 = taskWithSchema.toDefinition();

        expect(def1).toEqual({
            name: "email-task",
            options: { attempts: 2 },
            schema: schemaFn,
        });
        expect(def2).toEqual(def1);

        // Test build() when options is undefined, schema is undefined, or either is present
        const bareDef = task("bare").build();
        expect(bareDef).toEqual({ name: "bare" });

        const onlySchemaDef = task({ name: "only-schema", schema: schemaFn }).build();
        expect(onlySchemaDef).toEqual({ name: "only-schema", schema: schemaFn });

        const onlyOptsDef = task("only-opts").priority(1).build();
        expect(onlyOptsDef).toEqual({ name: "only-opts", options: { priority: 1 } });
    });

    it("should support merging options via .withOptions() with JobOptions or JobOptionsBuilder", () => {
        const mergedDirect = task("t").withOptions({ priority: 3 });
        expect(mergedDirect.options?.priority).toBe(3);

        const mergedFromBuilder = task("t").withOptions(
            jobOptions().attempts(5).backoff("fixed", 100),
        );
        expect(mergedFromBuilder.options).toEqual({
            attempts: 5,
            backoff: { type: "fixed", delay: 100 },
        });
    });
});
