import { describe, expect, it, vi } from "vitest";
import { CreditFlowController } from "../../src/application/flow-control/credit-flow-controller.js";

describe("CreditFlowController", () => {
    it("should initialize with max credits and allow consumption", () => {
        const controller = new CreditFlowController({ maxCredits: 100 });
        expect(controller.getAvailableCredits()).toBe(100);
        expect(controller.hasCredit()).toBe(true);

        const granted = controller.consume(30);
        expect(granted).toBe(30);
        expect(controller.getAvailableCredits()).toBe(70);
    });

    it("should limit consumption to available credits and apply backpressure", () => {
        const controller = new CreditFlowController({ maxCredits: 10 });

        const first = controller.consume(8);
        expect(first).toBe(8);
        expect(controller.getAvailableCredits()).toBe(2);

        // Request 5, but only 2 available
        const second = controller.consume(5);
        expect(second).toBe(2);
        expect(controller.getAvailableCredits()).toBe(0);
        expect(controller.hasCredit()).toBe(false);
    });

    it("should replenish credits upon ACK / NACK and notify replenisher", () => {
        const onReplenish = vi.fn();
        const controller = new CreditFlowController({
            maxCredits: 50,
            replenishBatchThreshold: 10,
            onReplenishNotice: onReplenish,
        });

        controller.consume(25);
        expect(controller.getAvailableCredits()).toBe(25);

        // Replenish 5 (below threshold of 10) -> no notice yet
        controller.replenish(5);
        expect(controller.getAvailableCredits()).toBe(30);
        expect(onReplenish).not.toHaveBeenCalled();

        // Replenish another 6 -> total pending 11 >= 10 -> triggers notice!
        controller.replenish(6);
        expect(controller.getAvailableCredits()).toBe(36);
        expect(onReplenish).toHaveBeenCalledWith(11);
    });

    it("should reset credits to initial capacity on reset()", () => {
        const controller = new CreditFlowController({ maxCredits: 100 });
        controller.consume(80);
        expect(controller.getAvailableCredits()).toBe(20);

        controller.reset();
        expect(controller.getAvailableCredits()).toBe(100);
        expect(controller.hasCredit()).toBe(true);
    });

    it("should handle edge cases: zero/negative consume, zero/negative replenish, min credits, and default threshold", () => {
        // maxCredits clamped to 1 when <= 0; replenishBatchThreshold defaulted to Math.max(1, floor(1/4)) = 1
        const controller = new CreditFlowController({ maxCredits: -5 });
        expect(controller.getAvailableCredits()).toBe(1);

        // consume <= 0
        expect(controller.consume(0)).toBe(0);
        expect(controller.consume(-10)).toBe(0);
        expect(controller.getAvailableCredits()).toBe(1);

        // replenish <= 0
        controller.consume(1);
        expect(controller.getAvailableCredits()).toBe(0);
        controller.replenish(0);
        controller.replenish(-3);
        expect(controller.getAvailableCredits()).toBe(0);

        // replenish without onReplenishNotice callback (reaches threshold 1)
        controller.replenish(1);
        expect(controller.getAvailableCredits()).toBe(1);
    });
});
