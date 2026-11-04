import type { Resource } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type BatchingSink, type BatchingSinkOptions, type BatchSink, createBatchingSink } from "./batching-sink";
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

// The `process` global, typed for the listener queries this suite makes; Biome bans both the bare
// global and a `node:process` import.
const nodeProcess = (
  globalThis as unknown as {
    process: { listeners(event: "exit"): (() => void)[]; listenerCount(event: "exit"): number };
  }
).process;

const open: BatchingSink[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((sink) => sink.close()));
});

function setup(inner: BatchSink, options: BatchingSinkOptions = {}) {
  const time = createManualTime(1_000);
  const drops: unknown[][] = [];
  const sink = createBatchingSink(inner, {
    scheduler: time.scheduler,
    onDrop: (...args) => drops.push(args),
    lifecycle: {},
    ...options,
  });
  open.push(sink);
  return { sink, drops };
}

function syncInner() {
  const batches: string[][] = [];
  const inner: BatchSink = {
    writeBatch: (batch) => {
      batches.push(batch.map((e) => e.record.message));
    },
  };
  return { inner, batches };
}

/** Creates a sink with `options` and returns the `exit` listener its creation added, if any. */
function setupWithExitListener(inner: BatchSink, options: BatchingSinkOptions) {
  const before = new Set(nodeProcess.listeners("exit"));
  const created = setup(inner, options);
  const added = nodeProcess.listeners("exit").filter((listener) => !before.has(listener));
  return { ...created, added };
}

describe("createBatchingSink flushOnExit under Node", () => {
  it("adds one exit listener with flushOnExit, removed once close has drained", async () => {
    const baseline = nodeProcess.listenerCount("exit");
    const { sink, added } = setupWithExitListener(syncInner().inner, { flushOnExit: true });

    expect(added).toHaveLength(1);
    expect(nodeProcess.listenerCount("exit")).toBe(baseline + 1);

    expect(await sink.close()).toBe(true);
    expect(nodeProcess.listenerCount("exit")).toBe(baseline);
  });

  it("adds no exit listener without flushOnExit, or with it false", async () => {
    const baseline = nodeProcess.listenerCount("exit");
    const omitted = setupWithExitListener(syncInner().inner, {});
    const disabled = setupWithExitListener(syncInner().inner, { flushOnExit: false });

    expect(omitted.added).toEqual([]);
    expect(disabled.added).toEqual([]);
    expect(nodeProcess.listenerCount("exit")).toBe(baseline);
  });

  it("hands the whole buffer to a sync inner synchronously inside the exit listener, once", () => {
    const { inner, batches } = syncInner();
    const { sink, added } = setupWithExitListener(inner, { flushOnExit: true, limits: { maxBatchSize: 2 } });
    const [listener] = added as [() => void];

    sink.write(aRecord("a"), resource);
    expect(batches).toEqual([]);

    // The buffered record goes out with nothing awaited, as it must inside a real exit listener.
    listener();
    expect(batches).toEqual([["a"]]);

    sink.write(aRecord("b"), resource);
    listener();
    expect(batches).toEqual([["a"]]);
  });

  it("drops the buffer as failed when the inner throws inside the exit listener", () => {
    const boom = new Error("boom");
    const { sink, drops, added } = setupWithExitListener(
      {
        writeBatch: () => {
          throw boom;
        },
      },
      { flushOnExit: true },
    );
    const [listener] = added as [() => void];

    sink.write(aRecord("a"), resource);
    sink.write(aRecord("b"), resource);
    expect(() => listener()).not.toThrow();
    expect(drops).toEqual([["failed", 2, boom]]);
  });

  it("still hands the buffer on when the process exits while close waits on an async batch", async () => {
    const batches: string[][] = [];
    let settle = (): void => {};
    let calls = 0;
    const inner: BatchSink = {
      writeBatch: (batch) => {
        batches.push(batch.map((e) => e.record.message));
        calls += 1;
        if (calls === 1) {
          return new Promise<void>((resolve) => {
            settle = resolve;
          });
        }
        return undefined;
      },
    };
    const { sink, added } = setupWithExitListener(inner, { flushOnExit: true, limits: { maxBatchSize: 1 } });
    const [listener] = added as [() => void];

    sink.write(aRecord("a"), resource);
    sink.write(aRecord("b"), resource);
    sink.write(aRecord("c"), resource);
    const closing = sink.close();
    expect(batches).toEqual([["a"]]);

    listener();
    expect(batches).toEqual([["a"], ["b", "c"]]);

    settle();
    expect(await closing).toBe(true);
  });
});
