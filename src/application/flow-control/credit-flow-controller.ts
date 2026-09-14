export interface CreditFlowControllerOptions {
    maxCredits: number;
    replenishBatchThreshold?: number;
    onReplenishNotice?: (replenishedCount: number) => void;
}

export class CreditFlowController {
    private readonly maxCredits: number;
    private readonly replenishBatchThreshold: number;
    private readonly onReplenishNotice?: (replenishedCount: number) => void;

    private availableCredits: number;
    private pendingReplenishCount = 0;

    constructor(options: CreditFlowControllerOptions) {
        this.maxCredits = Math.max(1, options.maxCredits);
        this.replenishBatchThreshold =
            options.replenishBatchThreshold ?? Math.max(1, Math.floor(this.maxCredits / 4));
        this.onReplenishNotice = options.onReplenishNotice;
        this.availableCredits = this.maxCredits;
    }

    public getAvailableCredits(): number {
        return this.availableCredits;
    }

    public hasCredit(): boolean {
        return this.availableCredits > 0;
    }

    public consume(requested: number): number {
        if (requested <= 0) return 0;
        const grant = Math.min(requested, this.availableCredits);
        this.availableCredits -= grant;
        return grant;
    }

    public replenish(count: number): void {
        if (count <= 0) return;
        this.availableCredits = Math.min(this.maxCredits, this.availableCredits + count);
        this.pendingReplenishCount += count;

        if (this.pendingReplenishCount >= this.replenishBatchThreshold) {
            const batch = this.pendingReplenishCount;
            this.pendingReplenishCount = 0;
            if (this.onReplenishNotice) {
                this.onReplenishNotice(batch);
            }
        }
    }

    public reset(): void {
        this.availableCredits = this.maxCredits;
        this.pendingReplenishCount = 0;
    }
}
