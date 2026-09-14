export interface ITimerHandle {
    readonly id: string;
    readonly cancelled: boolean;
    cancel(): void;
}

export interface ITimingWheel {
    schedule(id: string, delayMs: number, callback: () => void): ITimerHandle;
    advance(nowMs?: number): number;
    cancel(id: string): boolean;
    size(): number;
    clear(): void;
}
