import type { SerializedError } from "@vipengele/ts-core-common";
import { type Resource, Scope } from "@vipengele/ts-core-common/scope";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { afterEach, describe, expect, test, vi } from "vitest";
import { emitRecord } from "./emit";
import type { EmitSettings, LogProcessor, LogRecord, Sink, SinkRegistration } from "./record";

const RESOURCE: Resource = Object.freeze({
  "service.name": "checkout",
  "service.version": "1.2.3",
  "service.dist": "web",
  "deployment.environment.name": "production",
  "process.runtime.name": "node",
  "process.runtime.version": "24.0.0",
  "os.type": "linux",
  "os.version": "6.1",
  "browser.name": "chrome",
  "browser.version": "126.0",
  "device.type": "desktop",
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

/** `sink` registered with `processors` running ahead of it alone. */
function registered(sink: Sink, ...processors: LogProcessor[]): SinkRegistration {
  return { sink, processors };
}

type SettingsOverrides = Partial<Omit<EmitSettings, "sinks">> & {
  /** A plain sink is registered with no processors of its own. */
  readonly sinks?: readonly (Sink | SinkRegistration)[];
};

function settings({ sinks = [], ...overrides }: SettingsOverrides = {}): EmitSettings {
  return {
    sinks: sinks.map((entry) => ("write" in entry ? registered(entry) : entry)),
    processors: [],
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

  test.each([
    { policy: "no policy", redaction: null },
    { policy: "a policy", redaction: secretKeys },
  ])("with $policy, a write at any depth of the attributes or the error chain throws and changes nothing", ({ redaction }) => {
    const after = collector();
    const onSinkError = vi.fn();
    const errorOf = (record: LogRecord): SerializedError => record.error as SerializedError;
    const causeOf = (record: LogRecord): SerializedError => (errorOf(record).errors as SerializedError[])[0]?.cause as SerializedError;
    const writes: ((record: LogRecord) => void)[] = [
      (record) => {
        (record.attributes.nested as Record<string, unknown>).value = "tampered";
      },
      (record) => {
        ((record.attributes.list as unknown[])[0] as Record<string, unknown>).value = "tampered";
      },
      (record) => {
        (errorOf(record).data as Record<string, unknown>).detail = "tampered";
      },
      (record) => {
        ((errorOf(record).data as Record<string, unknown>).meta as unknown[]).push("tampered");
      },
      (record) => {
        (errorOf(record).errors as unknown[]).push("tampered");
      },
      (record) => {
        causeOf(record).message = "tampered";
      },
      (record) => {
        (causeOf(record).data as Record<string, unknown>).retries = 0;
      },
    ];
    const tamperers: Sink[] = writes.map((write) => ({ write }));
    const cause = Object.assign(new Error("root"), { retries: 3 });
    const error = Object.assign(new AggregateError([new Error("member", { cause })], "outer"), { detail: "d", meta: [1] });

    emitRecord(
      settings({ sinks: [...tamperers, after], redaction, onSinkError }),
      "error",
      "a",
      "m",
      { nested: { value: "v" }, list: [{ value: "w" }] },
      error,
    );

    expect(onSinkError).toHaveBeenCalledTimes(writes.length);
    for (const [thrown] of onSinkError.mock.calls) {
      expect(thrown).toBeInstanceOf(TypeError);
    }
    const record = after.written[0]?.record as LogRecord;
    expect(record.attributes).toEqual({ nested: { value: "v" }, list: [{ value: "w" }] });
    expect(record.error?.data).toEqual({ detail: "d", meta: [1] });
    expect(record.error?.errors).toHaveLength(1);
    expect(record.error?.errors?.[0]?.cause).toMatchObject({ message: "root", data: { retries: 3 } });
  });

  test("freezing the record never freezes the caller's attributes or error", () => {
    const sink = collector();
    const attributes = { nested: { value: "v" }, list: [{ value: "w" }] };
    const meta = { tags: ["x"] };
    const error = Object.assign(new Error("e"), { meta });

    emitRecord(settings({ sinks: [sink], redaction: null }), "error", "a", "m", attributes, error);
    emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "error", "a", "m", attributes, error);

    expect(Object.isFrozen(sink.written[0]?.record.attributes.nested)).toBe(true);
    expect(Object.isFrozen(sink.written[1]?.record.error?.data?.meta)).toBe(true);
    for (const value of [attributes, attributes.nested, attributes.list, attributes.list[0], error, meta, meta.tags]) {
      expect(Object.isFrozen(value)).toBe(false);
    }
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

describe("emitRecord bindings", () => {
  test("merges the call's attributes over the bindings, the call winning a shared key", () => {
    const sink = collector();
    const bindings = Object.freeze({ requestId: "r-1", step: "bound" });

    emitRecord(settings({ sinks: [sink] }), "info", "a", "m", { step: "call", status: 200 }, undefined, bindings);
    emitRecord(settings({ sinks: [sink] }), "info", "a", "m", undefined, undefined, bindings);

    expect(sink.written.map(({ record }) => record.attributes)).toEqual([
      { requestId: "r-1", step: "call", status: 200 },
      { requestId: "r-1", step: "bound" },
    ]);
    expect(bindings).toEqual({ requestId: "r-1", step: "bound" });
  });

  test("redacts a bound secret key with the policy in force", () => {
    const sink = collector();

    emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "info", "a", "m", { user: "ada" }, undefined, { apiKey: "k" });

    expect(sink.written[0]?.record.attributes).toEqual({ apiKey: "[REDACTED]", user: "ada" });
  });
});

describe("emitRecord scope attributes", () => {
  const RESOURCE_KEYS = ["service.name", "service.version", "deployment.environment.name", "process.runtime.name"];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("carries the current Scope's attributes", () => {
    const sink = collector();

    Scope.isolated("request", { requestId: "r-1", user: "ada" }, () => {
      emitRecord(settings({ sinks: [sink] }), "info", "a", "m", undefined, undefined);
    });

    expect(sink.written[0]?.record.attributes).toEqual({ requestId: "r-1", user: "ada" });
  });

  test("takes every enclosing scope's attributes, the innermost winning a shared key", () => {
    const sink = collector();

    Scope.isolated("request", { outer: "outer", both: "outer" }, () => {
      Scope.inherit("step", { inner: "inner", both: "inner" }, () => {
        emitRecord(settings({ sinks: [sink] }), "info", "a", "m", undefined, undefined);
      });
    });

    expect(sink.written[0]?.record.attributes).toEqual({ outer: "outer", inner: "inner", both: "inner" });
  });

  test("lays the Scope beneath the bindings and the bindings beneath the call", () => {
    const sink = collector();
    const bindings = Object.freeze({ boundOver: "bound", allThree: "bound", bound: 1 });

    Scope.isolated("request", { boundOver: "scope", callOver: "scope", allThree: "scope", scoped: 1 }, () => {
      emitRecord(settings({ sinks: [sink] }), "info", "a", "m", { callOver: "call", allThree: "call", called: 1 }, undefined, bindings);
    });

    expect(sink.written[0]?.record.attributes).toEqual({
      boundOver: "bound",
      callOver: "call",
      allThree: "call",
      scoped: 1,
      bound: 1,
      called: 1,
    });
  });

  test("an isolated scope hides the attributes of the scope it runs inside", () => {
    const sink = collector();

    Scope.isolated("outer", { outer: true }, () => {
      Scope.isolated("inner", { inner: true }, () => {
        emitRecord(settings({ sinks: [sink] }), "info", "a", "m", undefined, undefined);
      });
    });

    expect(sink.written[0]?.record.attributes).toEqual({ inner: true });
  });

  test("normalizes the Scope's attributes into their JSON-safe shape", () => {
    const sink = collector();
    const date = new Date("2024-01-02T03:04:05.000Z");

    Scope.isolated("request", { at: date, big: 10n }, () => {
      emitRecord(settings({ sinks: [sink] }), "info", "a", "m", undefined, undefined);
    });

    expect(sink.written[0]?.record.attributes).toEqual({ at: date.toISOString(), big: "10n" });
  });

  test("redacts a secret key in the Scope with the secretKeys preset", () => {
    const sink = collector();

    Scope.isolated("request", { apiKey: "k", user: "ada" }, () => {
      emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "info", "a", "m", undefined, undefined);
    });

    expect(sink.written[0]?.record.attributes).toEqual({ apiKey: "[REDACTED]", user: "ada" });
  });

  test("never copies the Resource into the record's attributes", () => {
    // The realm's root is the default scope's parent; its attribute bag is put back afterwards so
    // the Resource set here never reaches another test.
    const defaultScope = Scope.current() as unknown as Record<symbol, unknown>;
    const root = defaultScope[Symbol.for("vipengele:scope:parent")] as Record<symbol, unknown>;
    const attributes = Symbol.for("vipengele:scope:attributes");
    const original = root[attributes];
    const sink = collector();

    try {
      Scope.setResource({ "service.name": "checkout", "service.version": "1.2.3" });
      Scope.isolated("request", { request: "a" }, () => {
        emitRecord(settings({ sinks: [sink] }), "info", "a", "m", { call: 1 }, undefined);
      });
    } finally {
      root[attributes] = original;
    }

    const recorded = sink.written[0]?.record.attributes;
    for (const key of RESOURCE_KEYS) {
      expect(recorded).not.toHaveProperty(key);
    }
    expect(recorded).toEqual({ request: "a", call: 1 });
  });

  test("still writes the record, with the bindings and the call's attributes, when reading the Scope throws", () => {
    const sink = collector();
    const onSinkError = vi.fn();
    vi.spyOn(Scope, "current").mockImplementation(() => {
      throw new Error("scope unreadable");
    });

    emitRecord(settings({ sinks: [sink], onSinkError }), "info", "a", "m", { called: 1 }, undefined, { bound: 1 });

    expect(sink.written).toHaveLength(1);
    expect(sink.written[0]?.record.attributes).toEqual({ bound: 1, called: 1 });
    expect(onSinkError).not.toHaveBeenCalled();
  });

  test("with no sink it never reads the Scope", () => {
    const current = vi.spyOn(Scope, "current");

    emitRecord(settings({ sinks: [] }), "info", "a", "m", undefined, undefined);

    expect(current).not.toHaveBeenCalled();
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

  test("a policy matching code redacts the code of every link, as it does the code in data", () => {
    const sink = collector();
    const policy: RedactionPolicy = { keys: ["code"] };
    const deepest = Object.assign(new Error("deepest"), { code: "E_DEEP" });
    const member = Object.assign(new Error("member", { cause: deepest }), { code: "E_MEMBER" });
    const error = Object.assign(new AggregateError([member], "outer"), { code: "E_OUTER" });

    emitRecord(settings({ sinks: [sink], redaction: policy }), "error", "a", "m", undefined, error);

    const recorded = sink.written[0]?.record.error;
    expect(recorded?.code).toBe("[REDACTED]");
    expect(recorded?.data).toEqual({ code: "[REDACTED]" });
    expect(recorded?.errors?.[0]?.code).toBe("[REDACTED]");
    expect(recorded?.errors?.[0]?.cause?.code).toBe("[REDACTED]");
    expect(JSON.stringify(sink.written[0]?.record)).not.toMatch(/E_DEEP|E_MEMBER|E_OUTER/u);
    expect([error.code, member.code, deepest.code]).toEqual(["E_OUTER", "E_MEMBER", "E_DEEP"]);
  });

  test("the secretKeys preset keeps an ordinary code such as ENOENT", () => {
    const sink = collector();
    const error = Object.assign(new Error("missing", { cause: Object.assign(new Error("inner"), { code: "EACCES" }) }), {
      code: "ENOENT",
    });

    emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "error", "a", "m", undefined, error);

    const recorded = sink.written[0]?.record.error;
    expect(recorded?.code).toBe("ENOENT");
    expect(recorded?.cause?.code).toBe("EACCES");
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

describe("emitRecord redaction of a thrown value that is not an Error", () => {
  const SECRET = "s3cr3t-value";

  /** The four places a structured non-Error value can sit in the chain, each holding one secret. */
  function thrownValues(secretKey: string): { readonly name: string; readonly thrown: () => unknown }[] {
    return [
      { name: "thrown itself", thrown: () => ({ [secretKey]: SECRET, reason: "quota", nested: [{ [secretKey]: SECRET }] }) },
      { name: "an Error's cause", thrown: () => new Error("outer", { cause: { [secretKey]: SECRET, reason: "quota" } }) },
      {
        name: "an entry of an AggregateError's errors",
        thrown: () => new AggregateError([new Error("member"), { [secretKey]: SECRET, reason: "quota" }], "many"),
      },
      {
        name: "a value whose JSON text is cut at the length bound",
        thrown: () => new Error("outer", { cause: { [secretKey]: SECRET, reason: "quota", blob: "x".repeat(9000) } }),
      },
    ];
  }

  /** The whole thrown value as text, an Error's `message`, `cause` and `errors` included. */
  function snapshotOf(value: unknown): string {
    return JSON.stringify(value, (_key, entry: unknown) =>
      entry instanceof Error ? { message: entry.message, cause: entry.cause, errors: (entry as Partial<AggregateError>).errors } : entry,
    );
  }

  const policies: { readonly policy: string; readonly redaction: RedactionPolicy; readonly secretKey: string }[] = [
    { policy: "the secretKeys preset", redaction: secretKeys, secretKey: "password" },
    { policy: "a custom policy", redaction: { keys: ["pin"] }, secretKey: "pin" },
  ];

  describe.each(policies)("under $policy", ({ redaction, secretKey }) => {
    test.each(thrownValues(secretKey))("a secret in a value $name reaches no sink", ({ thrown }) => {
      const sink = collector();
      const value = thrown();
      const snapshot = snapshotOf(value);

      emitRecord(settings({ sinks: [sink], redaction }), "error", "a", "m", undefined, value);

      expect(JSON.stringify(sink.written[0]?.record)).not.toContain(SECRET);
      expect(snapshotOf(value)).toBe(snapshot);
    });
  });

  /** Text a response body read with `res.text()` can start with ahead of its JSON. */
  const leaders = [
    { name: "a space", leader: " " },
    { name: "a newline", leader: "\n" },
    { name: "a tab", leader: "\t" },
    { name: "a byte order mark", leader: "\uFEFF" },
    { name: "a byte order mark and whitespace", leader: "\uFEFF\r\n  " },
  ];

  describe.each(policies)("under $policy, a thrown string led by", ({ redaction, secretKey }) => {
    test.each(leaders)("$name has its secret redacted", ({ leader }) => {
      const sink = collector();
      const body = JSON.stringify({ [secretKey]: SECRET, reason: "quota" });

      emitRecord(settings({ sinks: [sink], redaction }), "error", "a", "m", undefined, `${leader}${body}`);
      emitRecord(settings({ sinks: [sink], redaction }), "error", "a", "m", undefined, `${leader}[${body}]`);

      expect(JSON.stringify(sink.written[0]?.record)).not.toContain(SECRET);
      expect(sink.written[0]?.record.error?.message).toBe(`{"${secretKey}":"[REDACTED]","reason":"quota"}`);
      expect(JSON.stringify(sink.written[1]?.record)).not.toContain(SECRET);
    });
  });

  test("structured text after leading whitespace that does not parse is replaced whole", () => {
    const sink = collector();

    emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "error", "a", "m", undefined, '\uFEFF {"password":"p0"');

    expect(sink.written[0]?.record.error?.message).toBe("[REDACTED: unparseable structured value]");
  });

  test("the fields a policy does not match survive, at the top level and down the chain", () => {
    const sink = collector();
    const aggregate = new AggregateError([{ token: "t1", id: 7 }], "many", { cause: { password: "p1", reason: "quota" } });

    emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "error", "a", "m", undefined, { password: "p0", user: "ada" });
    emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "error", "a", "m", undefined, aggregate);

    expect(sink.written[0]?.record.error).toEqual({ type: "Error", message: '{"password":"[REDACTED]","user":"ada"}', synthetic: true });
    const error = sink.written[1]?.record.error;
    expect(error?.cause).toEqual({ type: "Error", message: '{"password":"[REDACTED]","reason":"quota"}', synthetic: true });
    expect(error?.errors).toEqual([{ type: "Error", message: '{"token":"[REDACTED]","id":7}', synthetic: true }]);
  });

  test("structured text that does not parse is replaced whole, and other thrown text is kept", () => {
    const sink = collector();
    const cut = { password: "p0", blob: "x".repeat(9000) };

    for (const thrown of [cut, [cut], "{ not json", "plain failure", "  padded failure", 42, null]) {
      emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "error", "a", "m", undefined, thrown);
    }

    expect(sink.written.map(({ record }) => record.error?.message)).toEqual([
      "[REDACTED: unparseable structured value]",
      "[REDACTED: unparseable structured value]",
      "[REDACTED: unparseable structured value]",
      "plain failure",
      "  padded failure",
      "42",
      "null",
    ]);
  });

  test("with no policy, a structured thrown value passes through unredacted", () => {
    const sink = collector();
    const cut = { password: "p0", blob: "x".repeat(9000) };

    emitRecord(settings({ sinks: [sink], redaction: null }), "error", "a", "m", undefined, { password: "p0" });
    emitRecord(settings({ sinks: [sink], redaction: null }), "error", "a", "m", undefined, new Error("outer", { cause: cut }));

    expect(sink.written[0]?.record.error?.message).toBe('{"password":"p0"}');
    expect(sink.written[1]?.record.error?.cause?.message).toMatch(/^\{"password":"p0","blob":"x+…\[truncated\]$/u);
  });

  test("the message and stack of a real Error are not scanned", () => {
    const sink = collector();
    const error = new Error('{"password":"p0"}');

    emitRecord(settings({ sinks: [sink], redaction: secretKeys }), "error", "a", "m", undefined, error);

    expect(sink.written[0]?.record.error?.message).toBe('{"password":"p0"}');
    expect(sink.written[0]?.record.error?.stack).toBe(error.stack);
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

  test("a throwing sink is reported with itself as the source on every failure, the same sink added twice included, and every other sink still receives the record", () => {
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
    expect(onSinkError.mock.calls).toEqual([
      [failure, failing],
      [failure, failing],
    ]);
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

describe("emitRecord processors", () => {
  /** A processor that replaces the record's message with `message`. */
  function rename(message: string): LogProcessor {
    return (record) => ({ ...record, message });
  }

  test("global processors run in order, ahead of every sink, each on what the previous returned", () => {
    const first = collector();
    const second = collector();
    const seen: string[] = [];
    const tag =
      (name: string): LogProcessor =>
      (record) => {
        seen.push(`${name}:${record.message}`);
        return { ...record, message: `${record.message}+${name}` };
      };

    emitRecord(settings({ sinks: [first, second], processors: [tag("a"), tag("b")] }), "info", "a", "m", undefined, undefined);

    expect(seen).toEqual(["a:m", "b:m+a"]);
    expect(first.written[0]?.record.message).toBe("m+a+b");
    expect(second.written[0]?.record).toBe(first.written[0]?.record);
    expect(first.written[0]?.resource).toBe(RESOURCE);
  });

  test("a global processor sees the record after built-in redaction", () => {
    const sink = collector();
    const seen = vi.fn((record: LogRecord) => record);

    emitRecord(settings({ sinks: [sink], processors: [seen], redaction: secretKeys }), "info", "a", "m", { password: "p" }, undefined);

    expect(seen.mock.calls[0]?.[0].attributes).toEqual({ password: "[REDACTED]" });
  });

  test("a null from a global processor drops the record for every sink, skipping later processors and the resource", () => {
    const first = collector();
    const second = collector();
    const later = vi.fn((record: LogRecord) => record);
    const perSink = vi.fn((record: LogRecord) => record);
    const resource = vi.fn(() => RESOURCE);

    emitRecord(
      settings({ sinks: [registered(first, perSink), second], processors: [() => null, later], resource }),
      "info",
      "a",
      "m",
      undefined,
      undefined,
    );

    expect(first.written).toHaveLength(0);
    expect(second.written).toHaveLength(0);
    expect(later).not.toHaveBeenCalled();
    expect(perSink).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
  });

  test("per-sink processors run after the global ones, in order, ahead of their own sink alone", () => {
    const plain = collector();
    const renamed = collector();
    const order: string[] = [];
    const step =
      (name: string, next: LogProcessor): LogProcessor =>
      (record) => {
        order.push(name);
        return next(record);
      };

    emitRecord(
      settings({
        sinks: [
          plain,
          registered(
            renamed,
            step("sink-1", rename("one")),
            step("sink-2", (record) => ({ ...record, category: "b" })),
          ),
        ],
        processors: [step("global", rename("global"))],
      }),
      "info",
      "a",
      "m",
      undefined,
      undefined,
    );

    expect(order).toEqual(["global", "sink-1", "sink-2"]);
    expect(plain.written[0]?.record).toMatchObject({ message: "global", category: "a" });
    expect(renamed.written[0]?.record).toMatchObject({ message: "one", category: "b" });
    expect(renamed.written[0]?.resource).toBe(RESOURCE);
  });

  test("a null from a per-sink processor drops the record for that sink only", () => {
    const before = collector();
    const dropped = collector();
    const after = collector();
    const later = vi.fn((record: LogRecord) => record);

    emitRecord(settings({ sinks: [before, registered(dropped, () => null, later), after] }), "info", "a", "m", undefined, undefined);

    expect(before.written).toHaveLength(1);
    expect(dropped.written).toHaveLength(0);
    expect(after.written).toHaveLength(1);
    expect(later).not.toHaveBeenCalled();
  });

  test("a throwing global processor drops the record for every sink without reaching the caller", () => {
    const sink = collector();
    const failing: LogProcessor = () => {
      throw new Error("processor");
    };

    expect(() => emitRecord(settings({ sinks: [sink], processors: [failing] }), "info", "a", "m", undefined, undefined)).not.toThrow();
    expect(sink.written).toHaveLength(0);
  });

  test("a throwing per-sink processor drops the record for that sink only, without reaching the caller", () => {
    const dropped = collector();
    const after = collector();
    const failing: LogProcessor = () => {
      throw new Error("processor");
    };

    expect(() =>
      emitRecord(settings({ sinks: [registered(dropped, failing), after] }), "info", "a", "m", undefined, undefined),
    ).not.toThrow();
    expect(dropped.written).toHaveLength(0);
    expect(after.written).toHaveLength(1);
  });

  test("with no sink no processor runs", () => {
    const processor = vi.fn((record: LogRecord) => record);

    emitRecord(settings({ sinks: [], processors: [processor] }), "info", "a", "m", undefined, undefined);

    expect(processor).not.toHaveBeenCalled();
  });
});

describe("emitRecord processor output", () => {
  /** A processor that returns `value` whatever it is handed. */
  function returning(value: unknown): LogProcessor {
    return () => value as LogRecord;
  }

  /** A processor that keeps the record but replaces its attributes with `attributes`. */
  function withAttributes(attributes: unknown): LogProcessor {
    return (record) => ({ ...record, attributes }) as LogRecord;
  }

  const malformed: { readonly name: string; readonly value: (record: LogRecord) => unknown }[] = [
    { name: "undefined", value: () => undefined },
    { name: "a string", value: () => "record" },
    { name: "a number", value: () => 42 },
    { name: "a function", value: () => () => {} },
    { name: "an array", value: () => [] },
    { name: "a record without time", value: ({ time, ...rest }) => rest },
    { name: "a record without level", value: ({ level, ...rest }) => rest },
    { name: "a record without category", value: ({ category, ...rest }) => rest },
    { name: "a record with a string time", value: (record) => ({ ...record, time: "now" }) },
    { name: "a record with a numeric level", value: (record) => ({ ...record, level: 30 }) },
    { name: "a record with a null category", value: (record) => ({ ...record, category: null }) },
    { name: "a record without message", value: ({ message, ...rest }) => rest },
    { name: "a record with a numeric message", value: (record) => ({ ...record, message: 42 }) },
    { name: "a record with a string error", value: (record) => ({ ...record, error: "boom" }) },
    { name: "a record with a null error", value: (record) => ({ ...record, error: null }) },
    { name: "a record whose error has no type", value: (record) => ({ ...record, error: { message: "boom" } }) },
    { name: "a record whose error has a numeric message", value: (record) => ({ ...record, error: { type: "Error", message: 1 } }) },
    {
      name: "a record whose error has a cause that is not an object",
      value: (record) => ({ ...record, error: { type: "Error", message: "boom", cause: 1 } }),
    },
  ];

  test.each(malformed)("a global processor returning $name drops the record for every sink, skipping the rest", ({ value }) => {
    const first = collector();
    const second = collector();
    const later = vi.fn((record: LogRecord) => record);
    const perSink = vi.fn((record: LogRecord) => record);
    const resource = vi.fn(() => RESOURCE);
    const onSinkError = vi.fn();
    const processor: LogProcessor = (record) => value(record) as LogRecord;

    expect(() =>
      emitRecord(
        settings({ sinks: [registered(first, perSink), second], processors: [processor, later], resource, onSinkError }),
        "info",
        "a",
        "m",
        undefined,
        undefined,
      ),
    ).not.toThrow();

    expect(first.written).toHaveLength(0);
    expect(second.written).toHaveLength(0);
    expect(later).not.toHaveBeenCalled();
    expect(perSink).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
    expect(onSinkError).toHaveBeenCalledOnce();
    expect(onSinkError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
    expect(onSinkError.mock.calls[0]?.[1]).toBe(processor);
  });

  test.each(malformed)("a per-sink processor returning $name drops the record for that sink only", ({ value }) => {
    const before = collector();
    const dropped = collector();
    const after = collector();
    const later = vi.fn((record: LogRecord) => record);
    const onSinkError = vi.fn();
    const processor: LogProcessor = (record) => value(record) as LogRecord;

    expect(() =>
      emitRecord(
        settings({ sinks: [before, registered(dropped, processor, later), after], onSinkError }),
        "info",
        "a",
        "m",
        undefined,
        undefined,
      ),
    ).not.toThrow();

    expect(before.written).toHaveLength(1);
    expect(dropped.written).toHaveLength(0);
    expect(after.written).toHaveLength(1);
    expect(later).not.toHaveBeenCalled();
    expect(onSinkError).toHaveBeenCalledOnce();
    expect(onSinkError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
    expect(onSinkError.mock.calls[0]?.[1]).toBe(processor);
  });

  test("a throwing global processor skips the processors after it and every sink's own, and is reported as the source", () => {
    const sink = collector();
    const later = vi.fn((record: LogRecord) => record);
    const perSink = vi.fn((record: LogRecord) => record);
    const failure = new Error("processor");
    const onSinkError = vi.fn();
    const failing: LogProcessor = () => {
      throw failure;
    };

    emitRecord(
      settings({ sinks: [registered(sink, perSink)], processors: [failing, later], onSinkError }),
      "info",
      "a",
      "m",
      undefined,
      undefined,
    );

    expect(later).not.toHaveBeenCalled();
    expect(perSink).not.toHaveBeenCalled();
    expect(sink.written).toHaveLength(0);
    expect(onSinkError.mock.calls).toEqual([[failure, failing]]);
  });

  test("a per-sink processor that throws skips the processors after it in that sink's chain alone, and is reported as the source", () => {
    const dropped = collector();
    const after = collector();
    const later = vi.fn((record: LogRecord) => record);
    const otherChain = vi.fn((record: LogRecord) => record);
    const failure = new Error("processor");
    const onSinkError = vi.fn();
    const failing: LogProcessor = () => {
      throw failure;
    };

    emitRecord(
      settings({ sinks: [registered(dropped, failing, later), registered(after, otherChain)], onSinkError }),
      "info",
      "a",
      "m",
      undefined,
      undefined,
    );

    expect(later).not.toHaveBeenCalled();
    expect(otherChain).toHaveBeenCalledOnce();
    expect(dropped.written).toHaveLength(0);
    expect(after.written).toHaveLength(1);
    expect(onSinkError.mock.calls).toEqual([[failure, failing]]);
  });

  test("a processor shared by the global chain and a sink's chain is reported as the source when it fails in the sink's chain", () => {
    const sink = collector();
    const failure = new Error("processor");
    const onSinkError = vi.fn();
    let calls = 0;
    const shared: LogProcessor = (record) => {
      calls += 1;
      if (calls === 2) {
        throw failure;
      }
      return record;
    };

    emitRecord(settings({ sinks: [registered(sink, shared)], processors: [shared], onSinkError }), "info", "a", "m", undefined, undefined);

    expect(sink.written).toHaveLength(0);
    expect(onSinkError.mock.calls).toEqual([[failure, shared]]);
  });

  test("a throwing onSinkError for a failed processor is swallowed, and the other sinks still receive the record", () => {
    const after = collector();
    const onSinkError = (): never => {
      throw new Error("report");
    };
    const failing: LogProcessor = () => {
      throw new Error("processor");
    };

    expect(() =>
      emitRecord(settings({ sinks: [registered(collector(), failing), after], onSinkError }), "info", "a", "m", undefined, undefined),
    ).not.toThrow();
    expect(after.written).toHaveLength(1);
  });

  test("cyclic attributes a processor returns reach the sink as a JSON-safe, frozen record", () => {
    const sink = collector();
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;

    emitRecord(settings({ sinks: [sink], processors: [withAttributes({ cyclic })] }), "info", "a", "m", undefined, undefined);

    const record = sink.written[0]?.record as LogRecord;
    expect(record.attributes).toEqual({ cyclic: { name: "loop", self: "[Circular]" } });
    expect(() => JSON.stringify(record)).not.toThrow();
    expect(Object.isFrozen(record.attributes.cyclic)).toBe(true);
    expect(Object.isFrozen(cyclic)).toBe(false);
  });

  test("attributes a processor returns are normalized into their JSON-safe shape", () => {
    const plain = collector();
    const renamed = collector();
    const date = new Date("2024-01-02T03:04:05.000Z");

    emitRecord(
      settings({
        sinks: [plain, registered(renamed, withAttributes({ at: date, big: 10n, tags: new Set(["y"]), skipped: undefined }))],
        processors: [withAttributes({ map: new Map([["k", 1]]), fn: undefined })],
      }),
      "info",
      "a",
      "m",
      undefined,
      undefined,
    );

    expect(plain.written[0]?.record.attributes).toEqual({ map: { k: 1 } });
    expect(renamed.written[0]?.record.attributes).toEqual({ at: date.toISOString(), big: "10n", tags: ["y"] });
  });

  test("attributes a processor leaves out, or returns as something no record can hold, become an empty record", () => {
    const missing = collector();
    const empty = collector();

    emitRecord(
      settings({
        sinks: [registered(missing, ({ attributes, ...rest }) => rest as LogRecord), registered(empty, withAttributes(null))],
      }),
      "info",
      "a",
      "m",
      { kept: "no" },
      undefined,
    );

    expect(missing.written[0]?.record.attributes).toEqual({});
    expect(empty.written[0]?.record.attributes).toEqual({});
  });

  test("attributes a processor passes through unchanged are not normalized a second time", () => {
    const sink = collector();
    const long = "x".repeat(10_000);
    let built: LogRecord | undefined;
    const capture: LogProcessor = (record) => {
      built = record;
      return record;
    };

    emitRecord(
      settings({ sinks: [sink], processors: [capture, (record) => ({ ...record, message: "renamed" })] }),
      "info",
      "a",
      "m",
      { long },
      undefined,
    );

    const record = sink.written[0]?.record as LogRecord;
    expect(record.message).toBe("renamed");
    expect(record.attributes).toBe(built?.attributes);
  });

  test("a processor returning the record it was handed passes that same frozen record on", () => {
    const sink = collector();
    let handed: LogRecord | undefined;
    const identity: LogProcessor = (record) => {
      handed = record;
      return record;
    };

    emitRecord(settings({ sinks: [registered(sink, identity)], processors: [identity] }), "info", "a", "m", undefined, undefined);

    expect(sink.written[0]?.record).toBe(handed);
    expect(Object.isFrozen(handed)).toBe(true);
  });

  test("the record a processor returns is deeply frozen, and the processor's own object is not", () => {
    const sink = collector();
    const onSinkError = vi.fn();
    const returned: LogRecord[] = [];
    const rebuild: LogProcessor = (record) => {
      const next = { ...record, attributes: { nested: { value: "v" }, list: [{ value: "w" }] } };
      returned.push(next);
      return next;
    };
    const tamper: Sink = {
      write(record) {
        (record.attributes.nested as Record<string, unknown>).value = "tampered";
      },
    };

    emitRecord(settings({ sinks: [tamper, sink], processors: [rebuild], onSinkError }), "info", "a", "m", undefined, undefined);

    const record = sink.written[0]?.record as LogRecord;
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.attributes.nested)).toBe(true);
    expect(Object.isFrozen((record.attributes.list as unknown[])[0])).toBe(true);
    expect(record.attributes).toEqual({ nested: { value: "v" }, list: [{ value: "w" }] });
    expect(onSinkError).toHaveBeenCalledOnce();
    expect(onSinkError.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
    expect(returned[0]).not.toBe(record);
    expect(Object.isFrozen(returned[0])).toBe(false);
  });

  test("each processor in a chain, global then per-sink, is handed a frozen record", () => {
    const sink = collector();
    const frozen: boolean[] = [];
    const step: LogProcessor = (record) => {
      frozen.push(Object.isFrozen(record), Object.isFrozen(record.attributes));
      return { ...record, attributes: { ...record.attributes, step: frozen.length } };
    };

    emitRecord(settings({ sinks: [registered(sink, step, step)], processors: [step, step] }), "info", "a", "m", undefined, undefined);

    expect(frozen).toEqual([true, true, true, true, true, true, true, true]);
    expect(sink.written[0]?.record.attributes).toEqual({ step: 8 });
    expect(Object.isFrozen(sink.written[0]?.record)).toBe(true);
  });

  test("a cyclic error a processor returns reaches the sink with each recurring link as a circular marker", () => {
    const sink = collector();
    const onSinkError = vi.fn();
    const loop: Record<string, unknown> = { type: "Error", message: "loop" };
    loop.cause = loop;
    loop.errors = [{ type: "Error", message: "sibling" }, loop];
    const cyclic: LogProcessor = (record) => ({ ...record, error: loop as unknown as SerializedError });

    emitRecord(settings({ sinks: [registered(sink, cyclic)], onSinkError }), "info", "a", "m", undefined, undefined);

    const circular = { type: "[Circular]", message: "an error already on this chain" };
    const record = sink.written[0]?.record as LogRecord;
    expect(record.error).toEqual({
      type: "Error",
      message: "loop",
      cause: circular,
      errors: [{ type: "Error", message: "sibling" }, circular],
    });
    expect(() => JSON.stringify(record)).not.toThrow();
    expect(Object.isFrozen(record.error?.cause)).toBe(true);
    expect(Object.isFrozen(loop)).toBe(false);
    expect(onSinkError).not.toHaveBeenCalled();
  });

  test("an error a processor returns is rebuilt with only JSON-safe SerializedError fields", () => {
    const sink = collector();
    const fn = function handler(): void {};
    const error = {
      type: "Error",
      message: "outer",
      code: 7,
      stack: { frames: [] },
      synthetic: "yes",
      data: { big: 10n, map: new Map([["k", 1]]), fn },
      extra: "dropped",
      errors: "not an array",
      cause: { type: "TypeError", message: "inner", code: "E_INNER", stack: "at x", synthetic: true, data: null },
    };

    emitRecord(
      settings({ sinks: [registered(sink, (record) => ({ ...record, error: error as unknown as SerializedError }))] }),
      "info",
      "a",
      "m",
      undefined,
      undefined,
    );

    const record = sink.written[0]?.record as LogRecord;
    expect(record.error).toEqual({
      type: "Error",
      message: "outer",
      data: { big: "10n", map: { k: 1 }, fn: expect.any(String) },
      cause: { type: "TypeError", message: "inner", code: "E_INNER", stack: "at x", synthetic: true, data: {} },
    });
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    expect(Object.isFrozen(record.error?.data)).toBe(true);
  });

  test("keys a processor adds outside the LogRecord fields are left out of the record", () => {
    const sink = collector();

    emitRecord(
      settings({ sinks: [registered(sink, (record) => ({ ...record, extra: 10n, nested: { k: "v" } }) as LogRecord)] }),
      "info",
      "a",
      "m",
      { kept: "yes" },
      undefined,
    );

    const record = sink.written[0]?.record as LogRecord;
    expect(Object.keys(record).sort()).toEqual(["attributes", "category", "level", "message", "time"]);
    expect(record.attributes).toEqual({ kept: "yes" });
  });

  test("the objects a processor returns its attributes and error in stay unfrozen", () => {
    const sink = collector();
    const attributes = { nested: { value: "v" } };
    const data = { inner: { value: "d" } };
    const cause = { type: "Error", message: "cause" };
    const error = { type: "Error", message: "outer", data, cause, errors: [cause] };
    const returned = { time: 1, level: "info", category: "a", message: "m", attributes, error };

    emitRecord(settings({ sinks: [registered(sink, () => returned as LogRecord)] }), "info", "a", "m", undefined, undefined);

    const record = sink.written[0]?.record as LogRecord;
    expect(record).toEqual(returned);
    expect(Object.isFrozen(record.error?.data?.inner)).toBe(true);
    for (const own of [returned, attributes, attributes.nested, error, data, data.inner, cause, error.errors]) {
      expect(Object.isFrozen(own)).toBe(false);
    }
  });

  test("an error a processor passes on, whole or as part of a new chain, is not normalized a second time", () => {
    const whole = collector();
    const wrapped = collector();
    const long = "x".repeat(10_000);
    const thrown = Object.assign(new AggregateError([new Error("entry")], "inner"), { long });
    let built: LogRecord | undefined;
    const capture: LogProcessor = (record) => {
      built = record;
      return record;
    };
    const wrap: LogProcessor = (record) => ({
      ...record,
      error: { type: "Error", message: "outer", data: record.error?.data, cause: record.error },
    });

    emitRecord(
      settings({
        sinks: [registered(whole, (record) => ({ ...record, message: "renamed" })), registered(wrapped, wrap)],
        processors: [capture],
      }),
      "info",
      "a",
      "m",
      undefined,
      thrown,
    );

    expect(whole.written[0]?.record.error).toBe(built?.error);
    const error = wrapped.written[0]?.record.error;
    expect(error?.cause).toBe(built?.error);
    expect(error?.data).toBe(built?.error?.data);
  });

  /** A processor that keeps the record but replaces its error with `error`. */
  function withError(error: unknown): LogProcessor {
    return (record) => ({ ...record, error: error as SerializedError });
  }

  /** `length` characters of `"x"`, cut as `serializeError` cuts a string past the default length. */
  function truncated(length: number): string {
    return length > 8192 ? `${"x".repeat(8192)}…[truncated]` : "x".repeat(length);
  }

  test("the type, message, code and stack of each link of a processor's error are cut at the default string length", () => {
    const sink = collector();
    const long = "x".repeat(10_000);
    const link = { type: long, message: long, code: long, stack: long };

    emitRecord(
      settings({ sinks: [registered(sink, withError({ ...link, cause: link, errors: [link] }))] }),
      "info",
      "a",
      "m",
      undefined,
      undefined,
    );

    const cut = { type: truncated(10_000), message: truncated(10_000), code: truncated(10_000), stack: truncated(10_000) };
    expect(sink.written[0]?.record.error).toEqual({ ...cut, cause: cut, errors: [cut] });
  });

  test("a processor's error chain is cut with a truncation marker past five links, however deep it goes", () => {
    const sink = collector();
    const onSinkError = vi.fn();
    let deep: Record<string, unknown> = { type: "Error", message: "0" };
    for (let index = 1; index <= 100_000; index++) {
      deep = { type: "Error", message: String(index), cause: deep };
    }

    emitRecord(settings({ sinks: [registered(sink, withError(deep))], onSinkError }), "info", "a", "m", undefined, undefined);

    const messages: string[] = [];
    let link = sink.written[0]?.record.error;
    while (link !== undefined) {
      messages.push(link.message);
      link = link.cause;
    }
    expect(messages).toEqual(["100000", "99999", "99998", "99997", "99996", "99995", "the chain continues past 5 links"]);
    expect(onSinkError).not.toHaveBeenCalled();
  });

  test("a link of a processor's errors array past five links is cut with the same truncation marker", () => {
    const sink = collector();
    let nested: Record<string, unknown> = { type: "Error", message: "leaf" };
    for (let index = 0; index < 6; index++) {
      nested = { type: "AggregateError", message: String(index), errors: [nested] };
    }

    emitRecord(settings({ sinks: [registered(sink, withError(nested))] }), "info", "a", "m", undefined, undefined);

    let link = sink.written[0]?.record.error;
    for (let index = 0; index < 5; index++) {
      link = link?.errors?.[0];
    }
    expect(link?.errors).toEqual([{ type: "[Truncated]", message: "the chain continues past 5 links" }]);
  });

  test("an errors array a processor returns keeps its first 100 entries and summarises the rest", () => {
    const sink = collector();
    const entries = Array.from({ length: 250 }, (_, index) => ({ type: "Error", message: String(index) }));

    emitRecord(
      settings({ sinks: [registered(sink, withError({ type: "AggregateError", message: "many", errors: entries }))] }),
      "info",
      "a",
      "m",
      undefined,
      undefined,
    );

    const errors = sink.written[0]?.record.error?.errors ?? [];
    expect(errors).toHaveLength(101);
    expect(errors.slice(0, 100)).toEqual(entries.slice(0, 100));
    expect(errors[100]).toEqual({ type: "[Truncated]", message: "150 more errors" });
  });

  test("an errors array of exactly 100 entries a processor returns is kept whole, without a summary", () => {
    const sink = collector();
    const entries = Array.from({ length: 100 }, (_, index) => ({ type: "Error", message: String(index) }));

    emitRecord(
      settings({ sinks: [registered(sink, withError({ type: "AggregateError", message: "many", errors: entries }))] }),
      "info",
      "a",
      "m",
      undefined,
      undefined,
    );

    expect(sink.written[0]?.record.error?.errors).toEqual(entries);
  });

  test("an already bounded error a processor nests deep in a new chain is kept as it is, neither cut again nor truncated", () => {
    const sink = collector();
    const thrown = new Error("x".repeat(10_000), { cause: new Error("inner") });
    let built: LogRecord | undefined;
    const wrap: LogProcessor = (record) => {
      built = record;
      let chain: unknown = record.error;
      for (let index = 0; index < 5; index++) {
        chain = { type: "Error", message: `wrapper ${index}`, cause: chain };
      }
      return { ...record, error: chain as SerializedError };
    };

    emitRecord(settings({ sinks: [registered(sink, wrap)] }), "info", "a", "m", undefined, thrown);

    let link = sink.written[0]?.record.error;
    for (let index = 0; index < 5; index++) {
      link = link?.cause;
    }
    expect(link).toBe(built?.error);
    expect(link?.message).toBe(truncated(10_000));
    expect(link?.cause).toEqual(expect.objectContaining({ type: "Error", message: "inner" }));
  });

  test("a valid record from a per-sink processor reaches its sink alongside the other sinks' records", () => {
    const plain = collector();
    const replaced = collector();
    const replacement = { time: 1, level: "error", category: "b", message: "other", attributes: { k: "v" } };

    emitRecord(settings({ sinks: [plain, registered(replaced, returning(replacement))] }), "info", "a", "m", undefined, undefined);

    expect(plain.written[0]?.record).toMatchObject({ time: 1_700_000_000_000.25, level: "info", category: "a", message: "m" });
    expect(replaced.written[0]?.record).toEqual(replacement);
    expect(Object.isFrozen(replaced.written[0]?.record)).toBe(true);
    expect(Object.isFrozen(replacement)).toBe(false);
  });
});
