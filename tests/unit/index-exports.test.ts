import { describe, expect, it } from "@jest/globals";
import * as DragonflyIndex from "../../src/infrastructure/dragonfly/index.js";
import * as KodiakIndex from "../../src/presentation/index.js";

describe("Index Exports", () => {
    it("should export all presentation layer public classes and functions", () => {
        expect(KodiakIndex.Kodiak).toBeDefined();
        expect(KodiakIndex.Queue).toBeDefined();
        expect(KodiakIndex.Worker).toBeDefined();
        expect(KodiakIndex.task).toBeDefined();
        expect(KodiakIndex.AdaptivePrefetchManager).toBeDefined();
        expect(KodiakIndex.WorkerAckBuffer).toBeDefined();
        expect(KodiakIndex.JobContextPool).toBeDefined();
        expect(KodiakIndex.PooledJobContext).toBeDefined();
        expect(KodiakIndex.CreditFlowController).toBeDefined();
        expect(KodiakIndex.SlabBufferPool).toBeDefined();
        expect(KodiakIndex.KodiakFrameCodec).toBeDefined();
        expect(KodiakIndex.KodiakTcpServer).toBeDefined();
        expect(KodiakIndex.MsgpackJobSerializer).toBeDefined();
        expect(KodiakIndex.HierarchicalTimingWheel).toBeDefined();
        expect(KodiakIndex.DragonflyQueueRepository).toBeDefined();
        expect(KodiakIndex.KODIAK_FRAME_MAGIC).toBeDefined();
        expect(KodiakIndex.KODIAK_HEADER_SIZE).toBeDefined();
        expect(KodiakIndex.KodiakOpCode).toBeDefined();
    });

    it("should export all dragonfly infrastructure classes", () => {
        expect(DragonflyIndex.DragonflyConnection).toBeDefined();
        expect(DragonflyIndex.DragonflyKeyTopology).toBeDefined();
        expect(DragonflyIndex.DragonflyQueueRepository).toBeDefined();
        expect(DragonflyIndex.DragonflyScriptManager).toBeDefined();
    });
});
