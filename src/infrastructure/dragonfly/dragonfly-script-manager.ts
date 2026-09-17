import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Redis } from "ioredis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type ScriptName =
    | "add_job"
    | "move_to_active"
    | "complete_job"
    | "fail_job"
    | "detect_and_recover_stalled_jobs"
    | "promote_delayed_jobs"
    | "extend_lock"
    | "update_progress"
    | "move_job"
    | "release_jobs"
    | "retry_failed_job"
    | "clean_failed_jobs";

interface ScriptEntry {
    code: string;
    sha: string;
}

/**
 * Manages atomic Lua scripts for DragonflyDB.
 * Precomputes SHA1 hashes and executes scripts via EVALSHA to avoid sending
 * the full script body over TCP on every request.
 */
export class DragonflyScriptManager {
    private static instance: DragonflyScriptManager | null = null;
    private readonly scripts = new Map<ScriptName, ScriptEntry>();

    constructor() {
        this.loadScripts();
    }

    public static getInstance(): DragonflyScriptManager {
        if (!DragonflyScriptManager.instance) {
            DragonflyScriptManager.instance = new DragonflyScriptManager();
        }
        return DragonflyScriptManager.instance;
    }

    private loadScripts(): void {
        const scriptNames: ScriptName[] = [
            "add_job",
            "move_to_active",
            "complete_job",
            "fail_job",
            "detect_and_recover_stalled_jobs",
            "promote_delayed_jobs",
            "extend_lock",
            "update_progress",
            "move_job",
            "release_jobs",
            "retry_failed_job",
            "clean_failed_jobs",
        ];

        const searchDirs = [
            path.join(__dirname, "lua"),
            path.join(__dirname, "..", "redis", "lua"),
        ];

        for (const name of scriptNames) {
            let content: string | null = null;
            for (const dir of searchDirs) {
                const filePath = path.join(dir, `${name}.lua`);
                try {
                    content = fs.readFileSync(filePath, "utf8");
                    if (content) break;
                } catch {
                    // file does not exist or fs mock error
                }
            }

            if (!content) {
                content = "-- empty script\nreturn 1";
            }

            const sha = createHash("sha1").update(content).digest("hex");
            this.scripts.set(name, { code: content, sha });
        }
    }

    public getScriptCode(name: ScriptName): string {
        const entry = this.scripts.get(name);
        if (!entry) {
            throw new Error(`Script "${name}" not registered`);
        }
        return entry.code;
    }

    public getScriptSha(name: ScriptName): string {
        const entry = this.scripts.get(name);
        if (!entry) {
            throw new Error(`Script "${name}" not registered`);
        }
        return entry.sha;
    }

    /**
     * Executes a script via EVALSHA with automatic fallback to EVAL and reload if NOSCRIPT occurs.
     */
    public async execute(
        redis: Redis,
        name: ScriptName,
        keys: string[],
        args: (string | number)[],
    ): Promise<unknown> {
        const entry = this.scripts.get(name);
        if (!entry) {
            throw new Error(`Script "${name}" not found`);
        }

        const stringArgs = args.map((a) => String(a));

        if (typeof redis.evalsha === "function") {
            try {
                return await redis.evalsha(entry.sha, keys.length, ...keys, ...stringArgs);
            } catch (error: unknown) {
                const isNoScript = error instanceof Error && error.message.includes("NOSCRIPT");

                if (isNoScript && typeof redis.script === "function") {
                    try {
                        await redis.script("LOAD", entry.code);
                        return await redis.evalsha(entry.sha, keys.length, ...keys, ...stringArgs);
                    } catch {
                        // Fallback to direct eval below
                    }
                }
            }
        }

        if (typeof redis.eval === "function") {
            return await redis.eval(entry.code, keys.length, ...keys, ...stringArgs);
        }

        throw new Error("Redis client does not support eval or evalsha");
    }
}
