import { describe, expect, it } from "vitest";
import {
    JobOptionsBuilder,
    jobOptions,
    resolveJobOptions,
} from "../../src/application/dtos/job-options.builder.js";

describe("JobOptionsBuilder", () => {
    it("should instantiate with default empty options", () => {
        const builder = jobOptions();
        expect(builder).toBeInstanceOf(JobOptionsBuilder);
        expect(builder.build()).toEqual({});
    });

    it("should instantiate with another JobOptionsBuilder", () => {
        const initial = jobOptions().priority(10);
        const copied = new JobOptionsBuilder(initial);
        expect(copied.build()).toEqual({ priority: 10 });
    });

    it("should correctly resolve job options via resolveJobOptions helper", () => {
        expect(resolveJobOptions(undefined)).toBeUndefined();
        expect(resolveJobOptions({ priority: 2 })).toEqual({ priority: 2 });
        expect(resolveJobOptions(jobOptions().priority(3))).toEqual({ priority: 3 });
    });

    it("should configure priority, delay, and waitUntil immutably", () => {
        const base = jobOptions();
        const scheduledDate = new Date("2026-10-01T12:00:00Z");

        const withPriority = base.priority(5);
        const withDelay = withPriority.delay(2000);
        const withDate = withDelay.waitUntil(scheduledDate);

        expect(base.build()).toEqual({});
        expect(withPriority.build()).toEqual({ priority: 5 });
        expect(withDelay.build()).toEqual({ priority: 5, delay: 2000 });
        expect(withDate.build()).toEqual({
            priority: 5,
            delay: 2000,
            waitUntil: scheduledDate,
        });
    });

    it("should configure attempts and backoff overloads", () => {
        const fixedBackoff = jobOptions().attempts(3).backoff("fixed", 1000).build();

        expect(fixedBackoff).toEqual({
            attempts: 3,
            backoff: { type: "fixed", delay: 1000 },
        });

        // Test backoff with omitted delay defaulting to 0
        const defaultDelayBackoff = (
            jobOptions() as unknown as { backoff: (type: string) => JobOptionsBuilder }
        )
            .backoff("fixed")
            .build();
        expect(defaultDelayBackoff.backoff).toEqual({ type: "fixed", delay: 0 });

        const exponentialBackoff = jobOptions()
            .attempts(5)
            .backoff({ type: "exponential", delay: 500 })
            .build();

        expect(exponentialBackoff).toEqual({
            attempts: 5,
            backoff: { type: "exponential", delay: 500 },
        });
    });

    it("should configure repeat overloads", () => {
        const repeatEvery = jobOptions().repeat(60000).build();
        expect(repeatEvery).toEqual({ repeat: { every: 60000 } });

        const repeatWithLimit = jobOptions().repeat(30000, 10).build();
        expect(repeatWithLimit).toEqual({ repeat: { every: 30000, limit: 10 } });

        const repeatObj = jobOptions().repeat({ every: 15000, limit: 5 }).build();
        expect(repeatObj).toEqual({ repeat: { every: 15000, limit: 5 } });
    });

    it("should configure deduplication and idempotency", () => {
        const autoDedup = jobOptions().deduplicate().build();
        expect(autoDedup).toEqual({ deduplication: true });

        const booleanDedup = jobOptions().deduplication(false).build();
        expect(booleanDedup).toEqual({ deduplication: false });

        const customDedup = jobOptions()
            .deduplicate({ id: "order-99", ttl: 5000, strategy: "ignore-if-exists" })
            .build();
        expect(customDedup).toEqual({
            deduplication: { id: "order-99", ttl: 5000, strategy: "ignore-if-exists" },
        });
    });

    it("should configure lifecycle flags, traceparent, and bulk options", () => {
        const full = jobOptions({ priority: 1 })
            .traceparent("00-trace-id-01")
            .removeOnSuccess()
            .removeOnFailure(false)
            .options({ attempts: 4 })
            .options(jobOptions().priority(99))
            .build();

        expect(full).toEqual({
            priority: 99,
            traceparent: "00-trace-id-01",
            removeOnSuccess: true,
            removeOnFailure: false,
            attempts: 4,
        });
    });
});
