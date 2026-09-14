import { execSync } from "node:child_process";
import type { Redis } from "ioredis";

export interface CommandStat {
    calls: number;
    usec: number;
    usecPerCall: number;
}

export interface DragonflySnapshot {
    timestamp: number;
    commandsProcessed: number;
    pipelinedCommands: number;
    usedMemoryBytes: number;
    usedMemoryHuman: string;
    peakMemoryHuman: string;
    cpuUserSec: number;
    cpuSysSec: number;
    commandStats: Map<string, CommandStat>;
}

export interface CommandDiff {
    command: string;
    calls: number;
    totalMs: number;
    avgUsecPerCall: number;
}

export interface DragonflyDiff {
    durationMs: number;
    deltaCommands: number;
    opsPerSec: number;
    deltaPipelined: number;
    pipelinedRatio: number;
    deltaCpuMs: number;
    memoryHuman: string;
    memoryPeakHuman: string;
    topCommands: CommandDiff[];
}

export interface ContainerInfo {
    id: string;
    name: string;
    image: string;
    status: string;
    threads: number;
}

export class DragonflyMonitor {
    constructor(private readonly redisClient: Redis) {}

    public getContainerInfo(): ContainerInfo | null {
        try {
            const psOutput = execSync(
                'docker ps --filter "ancestor=docker.dragonflydb.io/dragonflydb/dragonfly" --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}"',
                { encoding: "utf-8" },
            ).trim();

            if (!psOutput) {
                // Fallback search with generic dragonfly
                const fallback = execSync(
                    'docker ps --filter "name=dragonfly" --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}"',
                    { encoding: "utf-8" },
                ).trim();
                if (!fallback) return null;
                return this.parsePsLine(fallback);
            }
            return this.parsePsLine(psOutput.split("\n")[0] ?? "");
        } catch {
            return null;
        }
    }

    private parsePsLine(line: string): ContainerInfo | null {
        const parts = line.split("|");
        if (parts.length < 4) return null;
        return {
            id: parts[0] ?? "",
            name: parts[1] ?? "",
            image: parts[2] ?? "",
            status: parts[3] ?? "",
            threads: 8,
        };
    }

    public async snapshot(): Promise<DragonflySnapshot> {
        const rawInfo = await this.redisClient.info();
        const rawCmdStats = await this.redisClient.info("commandstats");

        return {
            timestamp: Date.now(),
            commandsProcessed: this.parseNum(rawInfo, "total_commands_processed"),
            pipelinedCommands: this.parseNum(rawInfo, "total_pipelined_commands"),
            usedMemoryBytes: this.parseNum(rawInfo, "used_memory"),
            usedMemoryHuman: this.parseStr(rawInfo, "used_memory_human") || "0B",
            peakMemoryHuman: this.parseStr(rawInfo, "used_memory_peak_human") || "0B",
            cpuUserSec: this.parseFloatVal(rawInfo, "used_cpu_user"),
            cpuSysSec: this.parseFloatVal(rawInfo, "used_cpu_sys"),
            commandStats: this.parseCommandStats(rawCmdStats),
        };
    }

    public diff(before: DragonflySnapshot, after: DragonflySnapshot): DragonflyDiff {
        const durationMs = Math.max(1, after.timestamp - before.timestamp);
        const deltaCommands = Math.max(0, after.commandsProcessed - before.commandsProcessed);
        const deltaPipelined = Math.max(0, after.pipelinedCommands - before.pipelinedCommands);
        const opsPerSec = Math.round((deltaCommands / durationMs) * 1000);
        const pipelinedRatio = deltaCommands > 0 ? (deltaPipelined / deltaCommands) * 100 : 0;

        const deltaCpuSec =
            after.cpuUserSec + after.cpuSysSec - (before.cpuUserSec + before.cpuSysSec);
        const deltaCpuMs = Math.round(deltaCpuSec * 1000 * 100) / 100;

        const topCommands: CommandDiff[] = [];
        for (const [cmd, statAfter] of after.commandStats.entries()) {
            const statBefore = before.commandStats.get(cmd) ?? {
                calls: 0,
                usec: 0,
                usecPerCall: 0,
            };
            const calls = Math.max(0, statAfter.calls - statBefore.calls);
            const usec = Math.max(0, statAfter.usec - statBefore.usec);
            if (calls > 0) {
                topCommands.push({
                    command: cmd,
                    calls,
                    totalMs: Math.round((usec / 1000) * 100) / 100,
                    avgUsecPerCall: Math.round((usec / calls) * 100) / 100,
                });
            }
        }

        topCommands.sort((a, b) => b.totalMs - a.totalMs);

        return {
            durationMs,
            deltaCommands,
            opsPerSec,
            deltaPipelined,
            pipelinedRatio: Math.round(pipelinedRatio * 10) / 10,
            deltaCpuMs,
            memoryHuman: after.usedMemoryHuman,
            memoryPeakHuman: after.peakMemoryHuman,
            topCommands,
        };
    }

    private parseNum(info: string, key: string): number {
        const match = new RegExp(`^${key}:([0-9]+)`, "m").exec(info);
        return match ? Number(match[1]) : 0;
    }

    private parseFloatVal(info: string, key: string): number {
        const match = new RegExp(`^${key}:([0-9.]+)`, "m").exec(info);
        return match ? Number.parseFloat(match[1] ?? "0") : 0;
    }

    private parseStr(info: string, key: string): string {
        const match = new RegExp(`^${key}:(\\S+)`, "m").exec(info);
        return match ? (match[1] ?? "") : "";
    }

    private parseCommandStats(raw: string): Map<string, CommandStat> {
        const map = new Map<string, CommandStat>();
        const regex =
            /^cmdstat_([a-zA-Z0-9_-]+):calls=([0-9]+),usec=([0-9]+),usec_per_call=([0-9.]+)/gm;
        let m: RegExpExecArray | null = null;
        while (true) {
            m = regex.exec(raw);
            if (!m) break;
            const cmd = m[1];
            const calls = Number(m[2]);
            const usec = Number(m[3]);
            const usecPerCall = Number.parseFloat(m[4] ?? "0");
            if (cmd) {
                map.set(cmd, { calls, usec, usecPerCall });
            }
        }
        return map;
    }
}
