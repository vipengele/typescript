/**
 * The OpenTelemetry span a log record is correlated to (ADR-0007): its trace and span ids as hex
 * text, in the case OpenTelemetry gave them, and its W3C trace flags.
 */
export interface LogTrace {
  /** 32 hex characters, not all zeros. */
  readonly traceId: string;
  /** 16 hex characters, not all zeros. */
  readonly spanId: string;
  /** The span context's `traceFlags`, an integer. */
  readonly flags: number;
}

/**
 * The key `@opentelemetry/api` registers itself under on `globalThis`, and the context key it stores
 * the active span under. Both are internals of that package, held to by `trace.contract.test.ts`
 * (ADR-0021).
 */
const REGISTRY_KEY = "opentelemetry.js.api.1";
const SPAN_CONTEXT_KEY = "OpenTelemetry Context Key SPAN";

/**
 * The two symbols, resolved on first use so importing this module touches no registry. `Symbol.for`
 * returns the same symbol for a key in every copy, so holding it here shares nothing extra and
 * spares each written record two global symbol-registry lookups.
 */
let registrySymbol: symbol | undefined;
let spanContextSymbol: symbol | undefined;

function registrySlot(): symbol {
  registrySymbol ??= Symbol.for(REGISTRY_KEY);
  return registrySymbol;
}

function spanContextSlot(): symbol {
  spanContextSymbol ??= Symbol.for(SPAN_CONTEXT_KEY);
  return spanContextSymbol;
}

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/i;
const ALL_ZEROS_PATTERN = /^0+$/;

/** The parts of the API's registry the read touches; anything else on it is ignored. */
interface Registry {
  readonly context?: {
    active(): { getValue(key: symbol): unknown };
  };
}

interface SpanLike {
  spanContext(): { traceId?: unknown; spanId?: unknown; traceFlags?: unknown };
}

/** Whether `value` is a valid trace id: 32 hex characters, either case, not all zeros. */
export function isTraceId(value: unknown): value is string {
  return typeof value === "string" && TRACE_ID_PATTERN.test(value) && !ALL_ZEROS_PATTERN.test(value);
}

/** Whether `value` is a valid span id: 16 hex characters, either case, not all zeros. */
export function isSpanId(value: unknown): value is string {
  return typeof value === "string" && SPAN_ID_PATTERN.test(value) && !ALL_ZEROS_PATTERN.test(value);
}

/** Whether `value` is valid trace flags: an integer. */
export function isTraceFlags(value: unknown): value is number {
  return Number.isInteger(value);
}

/**
 * The span active in OpenTelemetry's registered context manager, as a fresh frozen
 * {@link LogTrace}, read synchronously from the registry `@opentelemetry/api` keeps on
 * `globalThis` (ADR-0021). Nothing is imported: an application without OpenTelemetry has no
 * registry, and the read gives `undefined`.
 *
 * `undefined` also stands for no context manager, no active span, ids that are malformed or all
 * zeros (the no-op tracer's), and flags that are not an integer. A throw anywhere in the read is
 * caught and gives `undefined`, so a broken context manager never reaches the caller.
 */
export function readActiveTrace(): LogTrace | undefined {
  try {
    const registry = (globalThis as unknown as Record<symbol, Registry | undefined>)[registrySlot()];
    const manager = registry?.context;
    if (manager === undefined) {
      return undefined;
    }
    const span = manager.active().getValue(spanContextSlot()) as SpanLike | undefined;
    if (span === undefined) {
      return undefined;
    }
    const { traceId, spanId, traceFlags } = span.spanContext();
    if (!isTraceId(traceId) || !isSpanId(spanId) || !isTraceFlags(traceFlags)) {
      return undefined;
    }
    return Object.freeze({ traceId, spanId, flags: traceFlags });
  } catch {
    return undefined;
  }
}
