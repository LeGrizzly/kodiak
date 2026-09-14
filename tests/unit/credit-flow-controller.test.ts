import { describe, expect, it, jest } from "@jest/globals";
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
        const onReplenish = jest.fn();
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
});
