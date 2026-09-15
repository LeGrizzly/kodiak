import { describe, expect, it, jest } from "@jest/globals";

let shouldFailAll = false;
let returnEmptyFirst = false;
let emptyCount = 0;

const mockRead = (filePath: unknown) => {
    if (shouldFailAll) {
        throw new Error("ENOENT: no such file or directory");
    }
    if (returnEmptyFirst) {
        emptyCount++;
        if (emptyCount % 2 === 1) return "";
        return "return 3";
    }
    if (String(filePath).includes("redis/lua")) {
        return "return 2";
    }
    throw new Error("ENOENT: not in primary dir");
};

jest.unstable_mockModule("node:fs", () => ({
    readFileSync: jest.fn().mockImplementation(mockRead),
    default: {
        readFileSync: jest.fn().mockImplementation(mockRead),
    },
}));

const { DragonflyScriptManager } = await import(
    "../../src/infrastructure/dragonfly/dragonfly-script-manager.js"
);

describe("DragonflyScriptManager fallback", () => {
    it("should fallback to secondary searchDir when primary dir fails", () => {
        shouldFailAll = false;
        returnEmptyFirst = false;
        const manager = new (
            DragonflyScriptManager as unknown as new () => InstanceType<
                typeof DragonflyScriptManager
            >
        )();
        expect(manager.getScriptCode("add_job")).toBe("return 2");
    });

    it("should fallback to default script content when all searchDirs fail", () => {
        shouldFailAll = true;
        returnEmptyFirst = false;
        const manager = new (
            DragonflyScriptManager as unknown as new () => InstanceType<
                typeof DragonflyScriptManager
            >
        )();
        expect(manager.getScriptCode("add_job")).toBe("-- empty script\nreturn 1");
    });

    it("should continue searching if file content is empty string in primary dir", () => {
        shouldFailAll = false;
        returnEmptyFirst = true;
        emptyCount = 0;

        const manager = new (
            DragonflyScriptManager as unknown as new () => InstanceType<
                typeof DragonflyScriptManager
            >
        )();
        expect(manager.getScriptCode("add_job")).toBe("return 3");
    });
});
