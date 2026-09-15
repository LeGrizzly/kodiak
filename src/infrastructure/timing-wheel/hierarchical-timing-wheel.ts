import type {
    ITimerHandle,
    ITimingWheel,
} from "../../domain/timing-wheel/timing-wheel.interface.js";

interface TimingWheelTask {
    id: string;
    deadlineMs: number;
    callback: () => void;
    cancelled: boolean;
}

export interface TimingWheelOptions {
    tickMs?: number;
    wheelSize?: number;
    startMs?: number;
}

export class TimingWheelLevel {
    public readonly tickMs: number;
    public readonly wheelSize: number;
    public readonly interval: number;
    public currentTime: number;
    public readonly buckets: Map<number, TimingWheelTask[]>;
    private overflowWheel: TimingWheelLevel | null = null;
    private readonly rootLevel: TimingWheelLevel;

    constructor(tickMs: number, wheelSize: number, startMs: number, rootLevel?: TimingWheelLevel) {
        this.tickMs = tickMs;
        this.wheelSize = wheelSize;
        this.interval = tickMs * wheelSize;
        this.currentTime = startMs - (startMs % tickMs);
        this.buckets = new Map();
        this.rootLevel = rootLevel ?? this;
    }

    public add(task: TimingWheelTask): void {
        if (task.cancelled) return;

        if (task.deadlineMs < this.currentTime + this.tickMs) {
            // Due on the next tick
            const bucketIndex =
                Math.floor((this.currentTime + this.tickMs) / this.tickMs) % this.wheelSize;
            this.addToBucket(bucketIndex, task);
        } else if (task.deadlineMs < this.currentTime + this.interval) {
            // Fits in this wheel level
            const bucketIndex = Math.floor(task.deadlineMs / this.tickMs) % this.wheelSize;
            this.addToBucket(bucketIndex, task);
        } else {
            // Needs overflow level
            if (!this.overflowWheel) {
                this.overflowWheel = new TimingWheelLevel(
                    this.interval,
                    this.wheelSize,
                    this.currentTime,
                    this.rootLevel,
                );
            }
            this.overflowWheel.add(task);
        }
    }

    private addToBucket(index: number, task: TimingWheelTask): void {
        let list = this.buckets.get(index);
        if (!list) {
            list = [];
            this.buckets.set(index, list);
        }
        list.push(task);
    }

    public advance(nowMs: number, expiredTasks: TimingWheelTask[]): void {
        while (nowMs >= this.currentTime + this.tickMs) {
            this.currentTime += this.tickMs;
            const bucketIndex = Math.floor(this.currentTime / this.tickMs) % this.wheelSize;
            const tasks = this.buckets.get(bucketIndex);
            if (tasks && tasks.length > 0) {
                this.buckets.delete(bucketIndex);
                for (const task of tasks) {
                    if (task.cancelled) continue;
                    if (task.deadlineMs <= nowMs) {
                        expiredTasks.push(task);
                    } else {
                        // Re-insert into root wheel hierarchy
                        this.rootLevel.add(task);
                    }
                }
            }
        }

        if (this.overflowWheel) {
            this.overflowWheel.advance(nowMs, expiredTasks);
        }
    }
}

export class HierarchicalTimingWheel implements ITimingWheel {
    private readonly rootLevel: TimingWheelLevel;
    private readonly tasks = new Map<string, TimingWheelTask>();

    constructor(options: TimingWheelOptions = {}) {
        const tickMs = options.tickMs ?? 10;
        const wheelSize = options.wheelSize ?? 64;
        const startMs = options.startMs ?? Date.now();
        this.rootLevel = new TimingWheelLevel(tickMs, wheelSize, startMs);
    }

    public schedule(id: string, delayMs: number, callback: () => void): ITimerHandle {
        if (this.tasks.has(id)) {
            this.cancel(id);
        }

        const deadlineMs = this.rootLevel.currentTime + Math.max(0, delayMs);
        const task: TimingWheelTask = {
            id,
            deadlineMs,
            callback,
            cancelled: false,
        };

        this.tasks.set(id, task);
        this.rootLevel.add(task);

        return {
            id,
            get cancelled() {
                return task.cancelled;
            },
            cancel: () => this.cancel(id),
        };
    }

    public advance(nowMs: number = Date.now()): number {
        const expired: TimingWheelTask[] = [];
        this.rootLevel.advance(nowMs, expired);

        let executedCount = 0;
        for (const task of expired) {
            if (!task.cancelled) {
                this.tasks.delete(task.id);
                try {
                    task.callback();
                    executedCount++;
                } catch (error) {
                    // Suppress unhandled exceptions from breaking the wheel
                    console.error(`[TimingWheel] Error executing timer task "${task.id}":`, error);
                }
            }
        }

        return executedCount;
    }

    public cancel(id: string): boolean {
        const task = this.tasks.get(id);
        if (!task || task.cancelled) return false;
        task.cancelled = true;
        this.tasks.delete(id);
        return true;
    }

    public size(): number {
        return this.tasks.size;
    }

    public clear(): void {
        for (const task of this.tasks.values()) {
            task.cancelled = true;
        }
        this.tasks.clear();
    }
}
