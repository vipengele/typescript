import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, it } from "vitest";
import { DEFAULT_DELIVERY_LIMITS } from "../delivery/delivery";
import { assertBatchingSinkOptions, type BatchEntry, type BatchSink, batchingSinkOptionsProblem, toBatchSink } from "./batching-sink";
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
