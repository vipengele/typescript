import type { Scheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, it } from "vitest";
import { DEFAULT_DELIVERY_LIMITS } from "../delivery/delivery";
import {
  assertBatchingSinkOptions,
  type BatchDropReason,
  type BatchEntry,
  type BatchingSinkOptions,
  type BatchSink,
  batchingSinkOptionsProblem,
  createBatchingSink,
  toBatchSink,
} from "./batching-sink";
import { isLoggingConfigError } from "./config-error";
import type { LogRecord, Sink } from "./record";

function aRecord(message: string): LogRecord {
  return Object.freeze({ time: 0, level: "info", category: "app", message, attributes: Object.freeze({}) });
}

function aResource(name: string): Resource {
  return Object.freeze({
    "service.name": name,
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
}

function entry(message: string, service = "svc"): BatchEntry {
  return { record: aRecord(message), resource: aResource(service) };
}

// biome-ignore lint/security/noSecrets: a function name, flagged only for its entropy
describe("batchingSinkOptionsProblem", () => {
  it("accepts no options, the defaults and valid limits", () => {
    expect(batchingSinkOptionsProblem({})).toBeUndefined();
    expect(batchingSinkOptionsProblem({ limits: {} })).toBeUndefined();
    expect(
      batchingSinkOptionsProblem({
        limits: {
          maxQueueSize: DEFAULT_DELIVERY_LIMITS.maxQueueSize,
          maxBatchSize: DEFAULT_DELIVERY_LIMITS.maxBatchSize,
          scheduleDelayMs: DEFAULT_DELIVERY_LIMITS.scheduleDelayMs,
        },
      }),
    ).toBeUndefined();
    expect(batchingSinkOptionsProblem({ limits: { maxQueueSize: 1, maxBatchSize: 1, scheduleDelayMs: 0.5 } })).toBeUndefined();
  });

  it.each([
    [{ maxQueueSize: 0 }, "maxQueueSize to be an integer of at least 1, got 0"],
    [{ maxQueueSize: 1.5 }, "maxQueueSize to be an integer of at least 1, got 1.5"],
    [{ maxBatchSize: -1 }, "maxBatchSize to be an integer of at least 1, got -1"],
    [{ maxBatchSize: Number.NaN }, "maxBatchSize to be an integer of at least 1, got NaN"],
    [{ scheduleDelayMs: 0 }, "scheduleDelayMs to be positive and finite, got 0"],
    [{ scheduleDelayMs: Number.POSITIVE_INFINITY }, "scheduleDelayMs to be positive and finite, got Infinity"],
  ])("names the invalid limit %j", (limits, problem) => {
    expect(batchingSinkOptionsProblem({ limits })).toBe(problem);
  });

  it("names the first invalid limit, the sizes before the delay", () => {
    expect(batchingSinkOptionsProblem({ limits: { scheduleDelayMs: 0, maxBatchSize: 0 } })).toContain("maxBatchSize");
  });
});

describe("assertBatchingSinkOptions", () => {
  it("returns for valid options", () => {
    expect(() => assertBatchingSinkOptions({})).not.toThrow();
  });

  it("throws a LoggingConfigError naming the caller and the problem", () => {
    let thrown: unknown;
    try {
      assertBatchingSinkOptions({ limits: { maxQueueSize: 0 } });
    } catch (error) {
      thrown = error;
    }
    expect(isLoggingConfigError(thrown)).toBe(true);
    expect((thrown as Error).message).toBe("createBatchingSink expects maxQueueSize to be an integer of at least 1, got 0");
  });
});

describe("toBatchSink", () => {
  it("returns a sink with writeBatch as it is", () => {
    const inner: BatchSink = { writeBatch: () => undefined };
    expect(toBatchSink(inner, () => undefined)).toBe(inner);
  });

  it("prefers writeBatch over write", () => {
    const batches: (readonly BatchEntry[])[] = [];
    const written: string[] = [];
    const inner = {
      writeBatch: (entries: readonly BatchEntry[]) => {
        batches.push(entries);
      },
      write: (record: LogRecord) => {
        written.push(record.message);
      },
    };
    const entries = [entry("a"), entry("b")];

    toBatchSink(inner, () => undefined).writeBatch(entries);

    expect(batches).toEqual([entries]);
    expect(written).toEqual([]);
  });

  it("replays a plain Sink in order with each entry's own Resource", () => {
    const seen: [string, string | undefined][] = [];
    const inner: Sink = {
      write: (record, resource) => {
        seen.push([record.message, resource["service.name"]]);
      },
    };

    toBatchSink(inner, () => undefined).writeBatch([entry("a", "one"), entry("b", "two"), entry("c", "one")]);

    expect(seen).toEqual([
      ["a", "one"],
      ["b", "two"],
      ["c", "one"],
    ]);
  });

  it("drops only the record that throws, reports it with count 1 and keeps replaying", () => {
    const seen: string[] = [];
    const failures: [number, unknown][] = [];
    const boom = new Error("boom");
    const inner: Sink = {
      write: (record) => {
        if (record.message === "b") {
          throw boom;
        }
        seen.push(record.message);
      },
    };

    toBatchSink(inner, (count, error) => failures.push([count, error])).writeBatch([entry("a"), entry("b"), entry("c")]);

    expect(seen).toEqual(["a", "c"]);
    expect(failures).toEqual([[1, boom]]);
  });
});

/** A BatchSink whose every batch returns a Promise the test settles by hand, oldest first. */
function deferredInner() {
  const batches: string[][] = [];
  const settlers: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  const inner: BatchSink = {
    writeBatch: (entries) => {
      batches.push(entries.map((e) => e.record.message));
      return new Promise<void>((resolve, reject) => {
        settlers.push({ resolve, reject });
      });
    },
  };
  return { inner, batches, settlers };
}

/** A BatchSink that records each batch's messages synchronously. */
function syncInner() {
  const batches: string[][] = [];
  const entries: BatchEntry[][] = [];
  const inner: BatchSink = {
    writeBatch: (batch) => {
      batches.push(batch.map((e) => e.record.message));
      entries.push([...batch]);
    },
  };
  return { inner, batches, entries };
}

function setup(inner: BatchSink | Sink, options: BatchingSinkOptions = {}) {
  const time = createManualTime(1_000);
  const drops: [BatchDropReason, number, ...unknown[]][] = [];
  const sink = createBatchingSink(inner, {
    scheduler: time.scheduler,
    onDrop: (...args) => drops.push(args),
    ...options,
  });
  const write = (...messages: string[]): void => {
    for (const message of messages) {
      sink.write(aRecord(message), aResource("svc"));
    }
  };
  return { sink, time, drops, write };
}

/** Lets pending microtasks and one macrotask run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createBatchingSink", () => {
  it("validates its options, throwing a LoggingConfigError", () => {
    let thrown: unknown;
    try {
      createBatchingSink(syncInner().inner, { limits: { maxBatchSize: 0 } });
    } catch (error) {
      thrown = error;
    }
    expect(isLoggingConfigError(thrown)).toBe(true);
    expect((thrown as Error).message).toBe("createBatchingSink expects maxBatchSize to be an integer of at least 1, got 0");
  });

  it("works with no options at all, holding records until flushed", async () => {
    const { inner, batches } = syncInner();
    const sink = createBatchingSink(inner);

    sink.write(aRecord("a"), aResource("svc"));
    expect(batches).toEqual([]);

    expect(await sink.flush()).toBe(true);
    expect(batches).toEqual([["a"]]);
    expect(await sink.close()).toBe(true);
  });

  it("hands a batch on once maxBatchSize records are buffered", async () => {
    const { inner, batches } = syncInner();
    const { write, time } = setup(inner, { limits: { maxBatchSize: 3 } });

    write("a", "b");
    expect(batches).toEqual([]);
    write("c");
    expect(batches).toEqual([["a", "b", "c"]]);
    await tick();
    expect(time.pendingSleeps).toBe(0);
  });

  it("hands a partial batch on once scheduleDelayMs passes, and arms no timer while empty", async () => {
    const { inner, batches } = syncInner();
    const { write, time } = setup(inner, { limits: { scheduleDelayMs: 100 } });

    expect(time.pendingSleeps).toBe(0);
    write("a");
    write("b");
    expect(time.pendingSleeps).toBe(1);

    await time.advance(99);
    expect(batches).toEqual([]);
    await time.advance(1);
    expect(batches).toEqual([["a", "b"]]);
    expect(time.pendingSleeps).toBe(0);
  });

  it("defaults the limits to the delivery core's", async () => {
    const { inner, batches } = syncInner();
    const { write, time } = setup(inner);

    write(...Array.from({ length: DEFAULT_DELIVERY_LIMITS.maxBatchSize - 1 }, (_, i) => `m${i}`));
    expect(batches).toEqual([]);
    await time.advance(DEFAULT_DELIVERY_LIMITS.scheduleDelayMs - 1);
    expect(batches).toEqual([]);
    await time.advance(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(DEFAULT_DELIVERY_LIMITS.maxBatchSize - 1);
  });

  it("keeps one batch in flight and starts the next full one when it settles", async () => {
    const { inner, batches, settlers } = deferredInner();
    const { write } = setup(inner, { limits: { maxBatchSize: 2 } });

    write("a", "b", "c", "d", "e");
    expect(batches).toEqual([["a", "b"]]);

    settlers[0]?.resolve();
    await tick();
    expect(batches).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);

    settlers[1]?.resolve();
    await tick();
    expect(batches).toHaveLength(2);
  });

  it("re-arms the timer for what a settled batch leaves buffered", async () => {
    const { inner, batches, settlers } = deferredInner();
    const { write, time } = setup(inner, { limits: { maxBatchSize: 2, scheduleDelayMs: 100 } });

    write("a", "b", "c");
    expect(batches).toEqual([["a", "b"]]);
    await time.advance(100);
    expect(batches).toEqual([["a", "b"]]);
    expect(time.pendingSleeps).toBe(0);

    settlers[0]?.resolve();
    await tick();
    expect(time.pendingSleeps).toBe(1);
    await time.advance(99);
    expect(batches).toHaveLength(1);
    await time.advance(1);
    expect(batches).toEqual([["a", "b"], ["c"]]);
  });

  it("keeps a timer armed during a batch in flight when it has not yet elapsed", async () => {
    const { inner, batches, settlers } = deferredInner();
    const { write, time } = setup(inner, { limits: { maxBatchSize: 2, scheduleDelayMs: 100 } });

    write("a", "b", "c");
    await time.advance(50);
    settlers[0]?.resolve();
    await tick();
    expect(time.pendingSleeps).toBe(1);
    await time.advance(50);
    expect(batches).toEqual([["a", "b"], ["c"]]);
  });

  it("ignores a timer that resolved after the size trigger replaced it", () => {
    const { inner, batches } = syncInner();
    const resolved: Scheduler = { sleep: () => Promise.resolve() };
    const { write } = setup(inner, { scheduler: resolved, limits: { maxBatchSize: 2 } });

    write("a", "b");
    expect(batches).toEqual([["a", "b"]]);
    return tick().then(() => {
      expect(batches).toEqual([["a", "b"]]);
    });
  });

  it("never starts a second batch from a write made inside writeBatch", async () => {
    const batches: string[][] = [];
    const { write, sink } = setup(
      {
        writeBatch: (entries) => {
          batches.push(entries.map((e) => e.record.message));
          if (batches.length === 1) {
            write("x", "y");
          }
        },
      },
      { limits: { maxBatchSize: 2 } },
    );

    write("a", "b");
    expect(batches).toEqual([["a", "b"]]);
    await tick();
    expect(batches).toEqual([
      ["a", "b"],
      ["x", "y"],
    ]);
    expect(await sink.flush()).toBe(true);
  });

  it("drops a batch whose writeBatch throws as failed, with its size and the error", async () => {
    const boom = new Error("boom");
    const { write, sink, drops } = setup(
      {
        writeBatch: () => {
          throw boom;
        },
      },
      { limits: { maxBatchSize: 2 } },
    );

    expect(() => write("a", "b")).not.toThrow();
    expect(drops).toEqual([["failed", 2, boom]]);
    expect(await sink.flush()).toBe(true);
  });

  it("drops a batch whose writeBatch rejects as failed, and carries on with the next", async () => {
    const { inner, batches, settlers } = deferredInner();
    const { write, drops } = setup(inner, { limits: { maxBatchSize: 2 } });
    const boom = new Error("boom");

    write("a", "b", "c", "d");
    settlers[0]?.reject(boom);
    await tick();
    expect(drops).toEqual([["failed", 2, boom]]);
    expect(batches).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops only the plain Sink record that throws, as failed with a count of 1", async () => {
    const boom = new Error("boom");
    const seen: string[] = [];
    const { write, sink, drops } = setup({
      write: (record) => {
        if (record.message === "b") {
          throw boom;
        }
        seen.push(record.message);
      },
    });

    write("a", "b", "c");
    expect(await sink.flush()).toBe(true);
    expect(seen).toEqual(["a", "c"]);
    expect(drops).toEqual([["failed", 1, boom]]);
  });

  it("drops a record written to a full buffer as queue-full, keeping the buffered ones", async () => {
    const { inner, batches } = syncInner();
    const { write, sink, drops } = setup(inner, { limits: { maxQueueSize: 2 } });

    write("a", "b", "c");
    expect(drops).toEqual([["queue-full", 1]]);
    await sink.flush();
    expect(batches).toEqual([["a", "b"]]);
  });

  it("does not count the batch in flight against maxQueueSize", () => {
    const { inner, batches } = deferredInner();
    const { write, drops } = setup(inner, { limits: { maxQueueSize: 2, maxBatchSize: 2 } });

    write("a", "b", "c", "d", "e");
    expect(batches).toEqual([["a", "b"]]);
    expect(drops).toEqual([["queue-full", 1]]);
  });

  it("swallows a throwing onDrop", () => {
    const { inner } = syncInner();
    const { write } = setup(inner, {
      limits: { maxQueueSize: 1 },
      onDrop: () => {
        throw new Error("observer");
      },
    });

    expect(() => write("a", "b")).not.toThrow();
  });

  it("preserves each entry's own Resource within a batch", async () => {
    const { inner, entries } = syncInner();
    const { sink } = setup(inner);
    const one = aResource("one");
    const two = aResource("two");

    sink.write(aRecord("a"), one);
    sink.write(aRecord("b"), two);
    sink.write(aRecord("c"), one);
    await sink.flush();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.map((e) => [e.record.message, e.resource])).toEqual([
      ["a", one],
      ["b", two],
      ["c", one],
    ]);
    expect(entries[0]?.[1]?.resource).toBe(two);
  });

  describe("flush", () => {
    it("resolves true at once when nothing is buffered or in flight", async () => {
      const { inner } = syncInner();
      const { sink } = setup(inner);
      expect(await sink.flush()).toBe(true);
    });

    it("drains the buffer batch by batch, one in flight at a time, and aborts the timer", async () => {
      const { inner, batches, settlers } = deferredInner();
      const { write, sink, time } = setup(inner, { limits: { maxBatchSize: 2 } });

      write("a");
      expect(time.pendingSleeps).toBe(1);
      write("b", "c", "d", "e");
      const flushed = sink.flush(10_000);
      expect(batches).toEqual([["a", "b"]]);

      settlers[0]?.resolve();
      await tick();
      expect(batches).toHaveLength(2);
      write("f");
      settlers[1]?.resolve();
      await tick();
      expect(batches).toEqual([
        ["a", "b"],
        ["c", "d"],
        ["e", "f"],
      ]);
      settlers[2]?.resolve();

      expect(await flushed).toBe(true);
      expect(time.pendingSleeps).toBe(0);
    });

    it("resolves false on timeout, keeps the buffer and re-arms the timer for it", async () => {
      const { inner, batches, settlers } = deferredInner();
      const { write, sink, time, drops } = setup(inner, { limits: { maxBatchSize: 2, scheduleDelayMs: 100 } });

      write("a", "b", "c");
      const flushed = sink.flush(50);
      await time.advance(50);
      expect(await flushed).toBe(false);
      expect(drops).toEqual([]);

      settlers[0]?.resolve();
      await tick();
      await time.advance(100);
      expect(batches).toEqual([["a", "b"], ["c"]]);
    });

    it("defaults its timeout to the delivery core's flush timeout", async () => {
      const { inner } = deferredInner();
      const { write, sink, time } = setup(inner);

      write("a");
      let result: boolean | undefined;
      void sink.flush().then((value) => {
        result = value;
      });
      await time.advance(DEFAULT_DELIVERY_LIMITS.flushTimeoutMs - 1);
      expect(result).toBeUndefined();
      await time.advance(1);
      expect(result).toBe(false);
    });

    it("resolves false rather than rejecting for an invalid timeout", async () => {
      const { inner } = deferredInner();
      const { write, sink } = setup(inner);
      write("a");
      expect(await sink.flush(-1)).toBe(false);
    });

    it("never calls the inner's flush or close", async () => {
      let lifecycleCalls = 0;
      const inner = {
        writeBatch: () => undefined,
        flush: () => {
          lifecycleCalls += 1;
          return Promise.resolve(true);
        },
        close: () => {
          lifecycleCalls += 1;
          return Promise.resolve(true);
        },
      };
      const { write, sink } = setup(inner);

      write("a");
      await sink.flush();
      write("b");
      await sink.close();
      expect(lifecycleCalls).toBe(0);
    });
  });

  describe("close", () => {
    it("drains, resolves true and drops every later write as closed", async () => {
      const { inner, batches } = syncInner();
      const { write, sink, drops } = setup(inner);

      write("a", "b");
      expect(await sink.close()).toBe(true);
      expect(batches).toEqual([["a", "b"]]);

      write("c");
      expect(drops).toEqual([["closed", 1]]);
      expect(batches).toHaveLength(1);
    });

    it("drops what is still buffered as closed on timeout, leaving the batch in flight to settle", async () => {
      const { inner, batches, settlers } = deferredInner();
      const { write, sink, time, drops } = setup(inner, { limits: { maxBatchSize: 2 } });
      const boom = new Error("boom");

      write("a", "b", "c", "d", "e");
      const closed = sink.close(50);
      await time.advance(50);
      expect(await closed).toBe(false);
      expect(drops).toEqual([["closed", 3]]);
      expect(time.pendingSleeps).toBe(0);

      settlers[0]?.reject(boom);
      await tick();
      expect(drops).toEqual([
        ["closed", 3],
        ["failed", 2, boom],
      ]);
      expect(batches).toEqual([["a", "b"]]);
    });

    it("drops nothing on timeout when only a batch in flight remains", async () => {
      const { inner } = deferredInner();
      const { write, sink, time, drops } = setup(inner, { limits: { maxBatchSize: 2 } });

      write("a", "b");
      const closed = sink.close(50);
      await time.advance(50);
      expect(await closed).toBe(false);
      expect(drops).toEqual([]);
    });

    it("is idempotent: a second close resolves as the first did without dropping again", async () => {
      const { inner } = deferredInner();
      const { write, sink, time, drops } = setup(inner, { limits: { maxBatchSize: 2 } });

      write("a", "b", "c");
      const first = sink.close(50);
      const second = sink.close(10_000);
      expect(second).toBe(first);
      await time.advance(50);
      expect(await first).toBe(false);
      expect(await sink.close()).toBe(false);
      expect(drops).toEqual([["closed", 1]]);
    });

    it("makes a later flush resolve as close did", async () => {
      const { inner } = syncInner();
      const { write, sink } = setup(inner);

      write("a");
      const closed = sink.close();
      expect(sink.flush()).toBe(closed);
      expect(await sink.flush()).toBe(true);
    });
  });
});
