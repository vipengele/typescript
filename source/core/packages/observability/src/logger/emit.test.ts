import type { Resource } from "@vipengele/ts-core-common/scope";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, test, vi } from "vitest";
import { emitRecord } from "./emit";
import type { EmitSettings, LogRecord, Sink } from "./record";

const RESOURCE: Resource = Object.freeze({
  "service.name": "checkout",
  "service.version": "1.2.3",
  "deployment.environment.name": "production",
  "process.runtime.name": "node",
});

interface Written {
  readonly record: LogRecord;
  readonly resource: Resource;
}

/** A sink that keeps every record it is handed. */
function collector(): Sink & { readonly written: Written[] } {
  const written: Written[] = [];
  return {
    written,
    write(record, resource) {
      written.push({ record, resource });
    },
  };
}

function settings(overrides: Partial<EmitSettings> = {}): EmitSettings {
  return {
    sinks: [],
    clock: () => 1_700_000_000_000.25,
    redaction: null,
    resource: () => RESOURCE,
    onSinkError: () => {},
    ...overrides,
  };
}

describe("emitRecord", () => {
  test("writes one record, with the resource, to every sink in order", () => {
    const order: string[] = [];
    const first = collector();
    const second = collector();
    const sinks: Sink[] = [
      {
        write(record, resource) {
          order.push("first");
          first.write(record, resource);
        },
      },
      {
        write(record, resource) {
          order.push("second");
          second.write(record, resource);
        },
      },
    ];

    emitRecord(settings({ sinks }), "info", "app.db", "connected", { host: "db1", port: 5432 }, undefined);

    expect(order).toEqual(["first", "second"]);
    expect(first.written).toHaveLength(1);
    const { record, resource } = first.written[0] as Written;
    expect(record).toEqual({
      time: 1_700_000_000_000.25,
      level: "info",
      category: "app.db",
      message: "connected",
      attributes: { host: "db1", port: 5432 },
    });
    expect(Object.hasOwn(record, "error")).toBe(false);
    expect(Object.hasOwn(record, "timestamp")).toBe(false);
    expect(resource).toBe(RESOURCE);
    expect(second.written[0]?.record).toBe(record);
  });

  test("the record is frozen, so one sink cannot change what the next one sees", () => {
    const after = collector();
    const onSinkError = vi.fn();
    const tamper: Sink = {
      write(record) {
        (record as { message: string }).message = "tampered";
      },
    };

    emitRecord(settings({ sinks: [tamper, after], onSinkError }), "warn", "a", "original", undefined, undefined);

    expect(Object.isFrozen(after.written[0]?.record)).toBe(true);
    expect(after.written[0]?.record.message).toBe("original");
    expect(onSinkError).toHaveBeenCalledOnce();
    expect(onSinkError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
  });

  test("normalizes the attributes into their JSON-safe shape, and defaults them to an empty record", () => {
    const sink = collector();
    const date = new Date("2024-01-02T03:04:05.000Z");

    emitRecord(
      settings({ sinks: [sink] }),
      "debug",
      "a",
      "m",
      { at: date, big: 10n, tags: new Set(["x"]), map: new Map([["k", 1]]), skipped: undefined },
      undefined,
    );
    emitRecord(settings({ sinks: [sink] }), "debug", "a", "m", undefined, undefined);

    expect(sink.written[0]?.record.attributes).toEqual({ at: date.toISOString(), big: "10n", tags: ["x"], map: { k: 1 } });
    expect(sink.written[1]?.record.attributes).toEqual({});
  });

  test("serializes an error with its whole cause and errors chain", () => {
    const sink = collector();
    const root = Object.assign(new Error("root cause"), { code: "ENOENT", path: "/tmp/x" });
    const inner = new TypeError("inner", { cause: root });
    const aggregate = new AggregateError([inner, "plain string"], "many failed");

    emitRecord(settings({ sinks: [sink] }), "error", "a", "failed", undefined, aggregate);

    const error = sink.written[0]?.record.error;
    expect(error).toMatchObject({
      type: "AggregateError",
      message: "many failed",
      errors: [
        {
          type: "TypeError",
          message: "inner",
          cause: { type: "Error", message: "root cause", code: "ENOENT", data: { code: "ENOENT", path: "/tmp/x" } },
        },
        { type: "Error", message: "plain string", synthetic: true },
      ],
    });
    expect(typeof error?.stack).toBe("string");
  });

  test("a thrown value that is not an Error, null included, is serialized as a synthetic error", () => {
    const sink = collector();

    emitRecord(settings({ sinks: [sink] }), "fatal", "a", "m", undefined, { reason: "quota" });
    emitRecord(settings({ sinks: [sink] }), "fatal", "a", "m", undefined, null);
    emitRecord(settings({ sinks: [sink] }), "fatal", "a", "m", undefined, 0);

    expect(sink.written.map(({ record }) => record.error)).toEqual([
      { type: "Error", message: '{"reason":"quota"}', synthetic: true },
      { type: "Error", message: "null", synthetic: true },
      { type: "Error", message: "0", synthetic: true },
    ]);
  });

  test("an undefined error gives a record without an error", () => {
    const sink = collector();

    emitRecord(settings({ sinks: [sink] }), "error", "a", "m", undefined, undefined);

    expect(Object.hasOwn(sink.written[0]?.record as LogRecord, "error")).toBe(false);
  });
});

describe("emitRecord redaction", () => {
  function chain(): Error {
    const deepest = Object.assign(new Error("deepest"), { password: "p3", count: 3 });
    const member = Object.assign(new Error("member", { cause: deepest }), { apiKey: "k2" });
    return Object.assign(new AggregateError([member], "outer"), { sessionId: "s1", user: "ada" });
  }

  test("with no policy, attributes and error data pass through unredacted", () => {
    const sink = collector();

    emitRecord(settings({ sinks: [sink], redaction: null }), "error", "a", "m", { password: "hunter2" }, chain());

    const { record } = sink.written[0] as Written;
    expect(record.attributes).toEqual({ password: "hunter2" });
    expect(record.error?.data).toEqual({ sessionId: "s1", user: "ada" });
    expect(record.error?.errors?.[0]?.data).toEqual({ apiKey: "k2" });
    expect(record.error?.errors?.[0]?.cause?.data).toEqual({ password: "p3", count: 3 });
  });

  test("the secretKeys preset redacts attributes and the data of every link of the error chain", () => {
    const sink = collector();
    const attributes = { user: "ada", auth: { accessToken: "t0", scope: "read" } };

    emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "error", "a", "m", attributes, chain());

    const { record } = sink.written[0] as Written;
    expect(record.attributes).toEqual({ user: "ada", auth: { accessToken: "[REDACTED]", scope: "read" } });
    expect(record.error?.data).toEqual({ sessionId: "[REDACTED]", user: "ada" });
    expect(record.error?.errors?.[0]?.data).toEqual({ apiKey: "[REDACTED]" });
    expect(record.error?.errors?.[0]?.cause?.data).toEqual({ password: "[REDACTED]", count: 3 });
    expect(attributes.auth.accessToken).toBe("t0");
  });

  test("a custom policy is applied as given, and message and stack are never scanned", () => {
    const sink = collector();
    const policy: RedactionPolicy = { keys: ["user", "message", "stack"] };
    const error = Object.assign(new Error("user ada failed"), { user: "ada" });

    emitRecord(settings({ sinks: [sink], redaction: policy }), "warn", "a", "user ada", { user: "ada", password: "p" }, error);

    const { record } = sink.written[0] as Written;
    expect(record.message).toBe("user ada");
    expect(record.attributes).toEqual({ user: "[REDACTED]", password: "p" });
    expect(record.error?.message).toBe("user ada failed");
    expect(record.error?.stack).toBe(error.stack);
    expect(record.error?.data).toEqual({ user: "[REDACTED]" });
  });

  test("redaction leaves the markers of the bounded attributes intact", () => {
    const sink = collector();
    const wide = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`k${index}`, index]));
    const long = "x".repeat(9000);

    emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "info", "a", "m", { wide, long }, undefined);

    const attributes = sink.written[0]?.record.attributes as Record<string, Record<string, unknown> | string>;
    expect((attributes.wide as Record<string, unknown>)["…"]).toBe("[Truncated: 1 more]");
    expect(attributes.long).toBe(`${"x".repeat(8192)}…[truncated]`);
  });
});

describe("emitRecord failure isolation", () => {
  test("with no sink it reads neither the clock, the attributes, the error, nor the resource", () => {
    const clock = vi.fn(() => 1);
    const resource = vi.fn(() => RESOURCE);
    const attributes = {
      get value(): never {
        throw new Error("attributes are read");
      },
    };
    const error = new Proxy(new Error("e"), {
      get() {
        throw new Error("error is read");
      },
    });

    emitRecord(settings({ sinks: [], clock, resource }), "info", "a", "m", attributes, error);

    expect(clock).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
  });

  test("a throwing sink is reported once, and every other sink still receives the record", () => {
    const before = collector();
    const after = collector();
    const failure = new Error("disk full");
    const onSinkError = vi.fn();
    const failing: Sink = {
      write() {
        throw failure;
      },
    };

    expect(() =>
      emitRecord(settings({ sinks: [before, failing, after, failing], onSinkError }), "info", "a", "m", undefined, undefined),
    ).not.toThrow();

    expect(before.written).toHaveLength(1);
    expect(after.written).toHaveLength(1);
    expect(onSinkError.mock.calls).toEqual([[failure], [failure]]);
  });

  test("a throwing onSinkError is swallowed, and later sinks still receive the record", () => {
    const after = collector();
    const failing: Sink = {
      write() {
        throw new Error("sink");
      },
    };
    const onSinkError = (): never => {
      throw new Error("report");
    };

    expect(() => emitRecord(settings({ sinks: [failing, after], onSinkError }), "info", "a", "m", undefined, undefined)).not.toThrow();
    expect(after.written).toHaveLength(1);
  });

  test("a throwing clock drops the record without reporting it", () => {
    const sink = collector();
    const onSinkError = vi.fn();
    const clock = (): number => {
      throw new Error("clock");
    };

    expect(() => emitRecord(settings({ sinks: [sink], clock, onSinkError }), "info", "a", "m", undefined, undefined)).not.toThrow();
    expect(sink.written).toHaveLength(0);
    expect(onSinkError).not.toHaveBeenCalled();
  });

  test("a throwing redaction policy drops the record without reporting it", () => {
    const sink = collector();
    const onSinkError = vi.fn();
    const redaction = {
      get keys(): never {
        throw new Error("policy");
      },
    } as RedactionPolicy;

    expect(() =>
      emitRecord(settings({ sinks: [sink], redaction, onSinkError }), "info", "a", "m", { user: "ada" }, undefined),
    ).not.toThrow();
    expect(sink.written).toHaveLength(0);
    expect(onSinkError).not.toHaveBeenCalled();
  });

  test("a throwing resource drops the record without reporting it", () => {
    const sink = collector();
    const onSinkError = vi.fn();
    const resource = (): Resource => {
      throw new Error("resource");
    };

    expect(() => emitRecord(settings({ sinks: [sink], resource, onSinkError }), "info", "a", "m", undefined, undefined)).not.toThrow();
    expect(sink.written).toHaveLength(0);
    expect(onSinkError).not.toHaveBeenCalled();
  });

  test("the resource is asked once per record, however many sinks there are", () => {
    const resource = vi.fn(() => RESOURCE);

    emitRecord(settings({ sinks: [collector(), collector()], resource }), "info", "a", "m", undefined, undefined);

    expect(resource).toHaveBeenCalledOnce();
  });

  test("a promise returned by write is not awaited, and its rejection never throws", () => {
    const after = collector();
    const onSinkError = vi.fn();
    const rejected = Promise.reject(new Error("async sink"));
    // The test observes the rejection itself, so that the runner does not report it as unhandled.
    rejected.catch(() => {});
    const asyncSink = { write: () => rejected } as unknown as Sink;

    const result: unknown = emitRecord(settings({ sinks: [asyncSink, after], onSinkError }), "info", "a", "m", undefined, undefined);

    expect(result).toBeUndefined();
    expect(after.written).toHaveLength(1);
    expect(onSinkError).not.toHaveBeenCalled();
  });
});
