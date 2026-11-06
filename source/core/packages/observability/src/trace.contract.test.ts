import {
  type Context,
  type ContextManager,
  context,
  INVALID_SPANID,
  INVALID_TRACEID,
  ROOT_CONTEXT,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import { afterEach, describe, expect, test } from "vitest";
import { readActiveTrace } from "./trace";

// The registry key and the span context key `readActiveTrace` reads are internals of
// `@opentelemetry/api` (ADR-0021). These tests drive the real API, so a release that moves either
// key fails here rather than silently dropping every record's trace.

// biome-ignore lint/security/noSecrets: the W3C Trace Context example trace id, flagged only for its entropy
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

/** A synchronous context manager: the active context is the top of a stack `with` pushes and pops. */
function createStackContextManager(): ContextManager {
  const stack: Context[] = [];
  const manager: ContextManager = {
    active: () => stack.at(-1) ?? ROOT_CONTEXT,
    with(ctx, fn, thisArg, ...args) {
      stack.push(ctx);
      try {
        return fn.call(thisArg, ...args);
      } finally {
        stack.pop();
      }
    },
    bind(ctx, target) {
      if (typeof target !== "function") {
        return target;
      }
      return function (this: unknown, ...args: unknown[]) {
        return manager.with(ctx, () => target.apply(this, args));
      } as typeof target;
    },
    enable: () => manager,
    disable() {
      stack.length = 0;
      return manager;
    },
  };
  return manager;
}

function withSpan<T>(spanContext: { traceId: string; spanId: string; traceFlags: number }, fn: () => T): T {
  const span = trace.wrapSpanContext(spanContext);
  return context.with(trace.setSpan(context.active(), span), fn);
}

afterEach(() => {
  context.disable();
  trace.disable();
});

describe("readActiveTrace against @opentelemetry/api", () => {
  test("gives nothing when no context manager is registered", () => {
    expect(readActiveTrace()).toBeUndefined();
    expect(withSpan({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: TraceFlags.SAMPLED }, readActiveTrace)).toBe(undefined);
  });

  describe("with a registered context manager", () => {
    afterEach(() => {
      expect(readActiveTrace()).toBeUndefined();
    });

    test("reads the span made active by context.with, and nothing outside it", () => {
      expect(context.setGlobalContextManager(createStackContextManager())).toBe(true);

      expect(readActiveTrace()).toBeUndefined();
      const inside = withSpan({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: TraceFlags.SAMPLED }, readActiveTrace);
      expect(inside).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, flags: 1 });
      expect(readActiveTrace()).toBeUndefined();
    });

    test("maps unsampled trace flags to flags 0", () => {
      context.setGlobalContextManager(createStackContextManager());

      const inside = withSpan({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: TraceFlags.NONE }, readActiveTrace);
      expect(inside).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, flags: 0 });
    });

    test("reads the innermost span when spans nest", () => {
      context.setGlobalContextManager(createStackContextManager());
      const innerSpanId = "00000000000000a1";

      const seen = withSpan({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 }, () => [
        withSpan({ traceId: TRACE_ID, spanId: innerSpanId, traceFlags: 1 }, readActiveTrace),
        readActiveTrace(),
      ]);
      expect(seen).toEqual([
        { traceId: TRACE_ID, spanId: innerSpanId, flags: 1 },
        { traceId: TRACE_ID, spanId: SPAN_ID, flags: 1 },
      ]);
    });

    test("gives nothing for a span context holding the API's invalid ids", () => {
      context.setGlobalContextManager(createStackContextManager());

      expect(withSpan({ traceId: INVALID_TRACEID, spanId: INVALID_SPANID, traceFlags: 0 }, readActiveTrace)).toBe(undefined);
      expect(withSpan({ traceId: TRACE_ID, spanId: INVALID_SPANID, traceFlags: 1 }, readActiveTrace)).toBe(undefined);
      expect(withSpan({ traceId: INVALID_TRACEID, spanId: SPAN_ID, traceFlags: 1 }, readActiveTrace)).toBe(undefined);
    });

    test("gives nothing inside a span started by the API's no-op tracer", () => {
      context.setGlobalContextManager(createStackContextManager());

      const inside = trace.getTracer("contract").startActiveSpan("noop", (span) => {
        const read = { active: trace.getActiveSpan(), ids: span.spanContext(), trace: readActiveTrace() };
        span.end();
        return read;
      });
      expect(inside.active).toBeDefined();
      expect(inside.ids).toMatchObject({ traceId: INVALID_TRACEID, spanId: INVALID_SPANID });
      expect(inside.trace).toBeUndefined();
    });
  });
});
