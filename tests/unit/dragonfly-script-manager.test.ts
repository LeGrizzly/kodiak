import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import {
    DragonflyScriptManager,
    type ScriptName,
} from "../../src/infrastructure/dragonfly/dragonfly-script-manager.js";

describe("DragonflyScriptManager", () => {
    it("should return the singleton instance and register known scripts", () => {
        const instance1 = DragonflyScriptManager.getInstance();
        const instance2 = DragonflyScriptManager.getInstance();
        expect(instance1).toBe(instance2);

        const code = instance1.getScriptCode("add_job");
        const sha = instance1.getScriptSha("add_job");

        expect(typeof code).toBe("string");
        expect(code.length).toBeGreaterThan(0);
        expect(typeof sha).toBe("string");
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("should throw when accessing an unregistered script", () => {
        const manager = DragonflyScriptManager.getInstance();
        const invalidScript = "non_existent" as ScriptName;

        expect(() => manager.getScriptCode(invalidScript)).toThrow(
            'Script "non_existent" not registered',
        );
        expect(() => manager.getScriptSha(invalidScript)).toThrow(
            'Script "non_existent" not registered',
        );
    });

    it("should throw when executing an unregistered script", async () => {
        const manager = DragonflyScriptManager.getInstance();
        const mockRedis = {} as Redis;
        const invalidScript = "non_existent" as ScriptName;

        await expect(manager.execute(mockRedis, invalidScript, [], [])).rejects.toThrow(
            'Script "non_existent" not found',
        );
    });

    it("should execute via evalsha when supported", async () => {
        const manager = DragonflyScriptManager.getInstance();
        const mockRedis = {
            evalsha: vi.fn().mockResolvedValue("result-123" as never),
        } as unknown as Redis;

        const result = await manager.execute(mockRedis, "add_job", ["k1"], ["arg1"]);
        expect(result).toBe("result-123");
        expect(mockRedis.evalsha).toHaveBeenCalledWith(
            manager.getScriptSha("add_job"),
            1,
            "k1",
            "arg1",
        );
    });

    it("should reload script and retry evalsha on NOSCRIPT error", async () => {
        const manager = DragonflyScriptManager.getInstance();
        const mockRedis = {
            evalsha: vi
                .fn()
                .mockRejectedValueOnce(new Error("NOSCRIPT No matching script") as never)
                .mockResolvedValueOnce("recovered-result" as never),
            script: vi.fn().mockResolvedValue("OK" as never),
        } as unknown as Redis;

        const result = await manager.execute(mockRedis, "add_job", ["k1"], ["arg1"]);
        expect(result).toBe("recovered-result");
        expect(mockRedis.script).toHaveBeenCalledWith("LOAD", manager.getScriptCode("add_job"));
        expect(mockRedis.evalsha).toHaveBeenCalledTimes(2);
    });

    it("should fallback to eval if script LOAD throws after NOSCRIPT", async () => {
        const manager = DragonflyScriptManager.getInstance();
        const mockRedis = {
            evalsha: vi.fn().mockRejectedValue(new Error("NOSCRIPT No matching script") as never),
            script: vi.fn().mockRejectedValue(new Error("SCRIPT LOAD failed") as never),
            eval: vi.fn().mockResolvedValue("eval-fallback-result" as never),
        } as unknown as Redis;

        const result = await manager.execute(mockRedis, "add_job", ["k1"], ["arg1"]);
        expect(result).toBe("eval-fallback-result");
        expect(mockRedis.eval).toHaveBeenCalledWith(
            manager.getScriptCode("add_job"),
            1,
            "k1",
            "arg1",
        );
    });

    it("should fallback to eval when evalsha fails with non-NOSCRIPT error or non-Error", async () => {
        const manager = DragonflyScriptManager.getInstance();
        const mockRedis1 = {
            evalsha: vi.fn().mockRejectedValue(new Error("SYNTAX ERROR") as never),
            eval: vi.fn().mockResolvedValue("eval-res1" as never),
        } as unknown as Redis;

        const res1 = await manager.execute(mockRedis1, "add_job", ["k1"], ["arg1"]);
        expect(res1).toBe("eval-res1");

        const mockRedis2 = {
            evalsha: vi.fn().mockRejectedValue("string-error" as never),
            eval: vi.fn().mockResolvedValue("eval-res2" as never),
        } as unknown as Redis;

        const res2 = await manager.execute(mockRedis2, "add_job", ["k1"], ["arg1"]);
        expect(res2).toBe("eval-res2");
    });

    it("should fallback to eval when NOSCRIPT occurs but redis.script is not a function", async () => {
        const manager = DragonflyScriptManager.getInstance();
        const mockRedis = {
            evalsha: vi.fn().mockRejectedValue(new Error("NOSCRIPT No matching script") as never),
            eval: vi.fn().mockResolvedValue("eval-no-script-fn" as never),
        } as unknown as Redis;

        const result = await manager.execute(mockRedis, "add_job", ["k1"], ["arg1"]);
        expect(result).toBe("eval-no-script-fn");
    });

    it("should execute directly via eval when evalsha is not a function", async () => {
        const manager = DragonflyScriptManager.getInstance();
        const mockRedis = {
            eval: vi.fn().mockResolvedValue("direct-eval-result" as never),
        } as unknown as Redis;

        const result = await manager.execute(mockRedis, "add_job", ["k1"], ["arg1"]);
        expect(result).toBe("direct-eval-result");
        expect(mockRedis.eval).toHaveBeenCalledWith(
            manager.getScriptCode("add_job"),
            1,
            "k1",
            "arg1",
        );
    });

    it("should throw if Redis client supports neither eval nor evalsha", async () => {
        const manager = DragonflyScriptManager.getInstance();
        const mockRedis = {} as unknown as Redis;

        await expect(manager.execute(mockRedis, "add_job", ["k1"], ["arg1"])).rejects.toThrow(
            "Redis client does not support eval or evalsha",
        );
    });
});
