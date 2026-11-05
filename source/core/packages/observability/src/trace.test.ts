import { afterEach, describe, expect, test, vi } from "vitest";
import { isSpanId, isTraceFlags, isTraceId, readActiveTrace } from "./trace";

const REGISTRY_SLOT = Symbol.for("opentelemetry.js.api.1");
const SPAN_KEY = Symbol.for("OpenTelemetry Context Key SPAN");

// biome-ignore lint/security/noSecrets: the W3C Trace Context example trace id, flagged only for its entropy
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

type Registry = Record<symbol, unknown>;
const registry = globalThis as unknown as Registry;

/** Registers a fake API whose context manager's active context holds `span` under the span key. */
function activate(span: unknown): void {
  registry[REGISTRY_SLOT] = {
    context: {
      active: () => ({ getValue: (key: symbol) => (key === SPAN_KEY ? span : undefined) }),
    },
  };
}

function spanWith(spanContext: unknown): { spanContext(): unknown } {
  return { spanContext: () => spanContext };
}

afterEach(() => {
  delete registry[REGISTRY_SLOT];
});

describe("readActiveTrace", () => {
  test("gives nothing when the registry slot is absent", () => {
    expect(readActiveTrace()).toBeUndefined();
  });

  test.for([null, 42, "api"])("gives nothing when the registry slot holds %o", (value) => {
    registry[REGISTRY_SLOT] = value;
    expect(readActiveTrace()).toBeUndefined();
  });

  test("gives nothing when the registry has no context manager", () => {
    registry[REGISTRY_SLOT] = { version: "1.9.0" };
    expect(readActiveTrace()).toBeUndefined();
  });

  test("gives nothing when the context manager's active() throws", () => {
    registry[REGISTRY_SLOT] = {
      context: {
        active: () => {
          throw new Error("boom");
        },
      },
    };
    expect(readActiveTrace()).toBeUndefined();
  });

  test("gives nothing when the context manager is malformed", () => {
    registry[REGISTRY_SLOT] = { context: {} };
    expect(readActiveTrace()).toBeUndefined();
  });

  test("gives nothing when no span is active", () => {
    activate(undefined);
    expect(readActiveTrace()).toBeUndefined();
  });

  test.for([null, {}, spanWith(undefined)])("gives nothing for the malformed span %o", (span) => {
    activate(span);
    expect(readActiveTrace()).toBeUndefined();
  });

  test("gives nothing when spanContext() throws", () => {
    activate({
      spanContext: () => {
        throw new Error("boom");
      },
    });
    expect(readActiveTrace()).toBeUndefined();
  });

  test("reads the span under the span key and maps traceFlags to flags", () => {
    const getValue = vi.fn((key: symbol) =>
      key === SPAN_KEY ? spanWith({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 }) : undefined,
    );
    registry[REGISTRY_SLOT] = { context: { active: () => ({ getValue }) } };
    expect(readActiveTrace()).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, flags: 1 });
    expect(getValue).toHaveBeenCalledExactlyOnceWith(SPAN_KEY);
  });

  test("keeps unsampled flags of 0", () => {
    activate(spanWith({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 0 }));
    expect(readActiveTrace()).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, flags: 0 });
  });

  test("returns a fresh frozen object with only traceId, spanId and flags", () => {
    const spanContext = { traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1, isRemote: true };
    activate(spanWith(spanContext));
    const first = readActiveTrace();
    const second = readActiveTrace();
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(first).not.toBe(spanContext);
    expect(Object.keys(first as object).sort()).toEqual(["flags", "spanId", "traceId"]);
    expect(Object.isFrozen(spanContext)).toBe(false);
  });

  test.for([
    ["an all-zero trace id", { traceId: "0".repeat(32), spanId: SPAN_ID, traceFlags: 1 }],
    ["an all-zero span id", { traceId: TRACE_ID, spanId: "0".repeat(16), traceFlags: 1 }],
    ["a short trace id", { traceId: TRACE_ID.slice(1), spanId: SPAN_ID, traceFlags: 1 }],
    ["a long span id", { traceId: TRACE_ID, spanId: `${SPAN_ID}0`, traceFlags: 1 }],
    ["a non-hex trace id", { traceId: `${TRACE_ID.slice(1)}g`, spanId: SPAN_ID, traceFlags: 1 }],
    ["a non-string span id", { traceId: TRACE_ID, spanId: 42, traceFlags: 1 }],
    ["missing traceFlags", { traceId: TRACE_ID, spanId: SPAN_ID }],
    ["string traceFlags", { traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: "1" }],
    ["fractional traceFlags", { traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1.5 }],
  ] as const)("gives nothing for %s", ([, spanContext]) => {
    activate(spanWith(spanContext));
    expect(readActiveTrace()).toBeUndefined();
  });
});

describe("isTraceId", () => {
  test.for([TRACE_ID, TRACE_ID.toUpperCase(), `${"0".repeat(31)}1`])("accepts %s", (value) => {
    expect(isTraceId(value)).toBe(true);
  });

  test.for(["0".repeat(32), TRACE_ID.slice(1), `${TRACE_ID}0`, `${TRACE_ID.slice(1)}z`, ` ${TRACE_ID.slice(1)}`, SPAN_ID, 42, undefined])(
    "rejects %o",
    (value) => {
      expect(isTraceId(value)).toBe(false);
    },
  );
});

describe("isSpanId", () => {
  test.for([SPAN_ID, SPAN_ID.toUpperCase(), `${"0".repeat(15)}1`])("accepts %s", (value) => {
    expect(isSpanId(value)).toBe(true);
  });

  test.for(["0".repeat(16), SPAN_ID.slice(1), `${SPAN_ID}0`, `${SPAN_ID.slice(1)}z`, TRACE_ID, 42, undefined])("rejects %o", (value) => {
    expect(isSpanId(value)).toBe(false);
  });
});

describe("isTraceFlags", () => {
  test.for([0, 1, 255])("accepts %d", (value) => {
    expect(isTraceFlags(value)).toBe(true);
  });

  test.for([1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", undefined, null])("rejects %o", (value) => {
    expect(isTraceFlags(value)).toBe(false);
  });
});
