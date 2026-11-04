import type { Resource } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, it } from "vitest";
import { type BatchSink, createBatchingSink } from "./batching-sink";
import type { LogRecord } from "./record";

function aRecord(message: string): LogRecord {
  return Object.freeze({ time: 0, level: "info", category: "app", message, attributes: Object.freeze({}) });
}

const resource: Resource = Object.freeze({
  "service.name": "svc",
  "service.version": undefined,
  "service.dist": undefined,
  "deployment.environment.name": undefined,
  "process.runtime.name": undefined,
  "process.runtime.version": undefined,
  "os.type": undefined,
  "os.version": undefined,
  "browser.name": undefined,
  "browser.version": undefined,
  "device.type": undefined,
});

describe("createBatchingSink flushOnExit in the browser", () => {
  it("adds no exit listener and ignores the option, the sink still batching and closing", async () => {
    const batches: string[][] = [];
    const inner: BatchSink = {
      writeBatch: (batch) => {
        batches.push(batch.map((e) => e.record.message));
      },
    };
    const time = createManualTime(1_000);
    const drops: unknown[][] = [];
    const sink = createBatchingSink(inner, {
      scheduler: time.scheduler,
      onDrop: (...args) => drops.push(args),
      lifecycle: {},
      flushOnExit: true,
      limits: { maxBatchSize: 2 },
    });

    expect((globalThis as { process?: unknown }).process).toBeUndefined();

    sink.write(aRecord("a"), resource);
    sink.write(aRecord("b"), resource);
    sink.write(aRecord("c"), resource);
    expect(batches).toEqual([["a", "b"]]);

    expect(await sink.close()).toBe(true);
    expect(batches).toEqual([["a", "b"], ["c"]]);
    expect(drops).toEqual([]);
  });
});
