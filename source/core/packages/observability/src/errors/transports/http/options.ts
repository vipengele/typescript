import { type Clock, type Scheduler, systemClock, systemScheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { MAX_TIMEOUT_DURATION_MS } from "@vipengele/ts-core-resilience/timeout";
import type { ErrorEvent } from "../../event";
import { HttpTransportConfigError } from "../http-transport-config-error";
import type { DropReason, QueueLimits } from "./queue";

/** Request headers: a fixed record, or a function resolved before every request. */
export type HttpHeaders = Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

/** What `createHttpTransport` accepts. Only `url` is required. */
export interface HttpTransportOptions {
  /** The absolute endpoint every batch is POSTed to. A relative URL is rejected. */
  readonly url: string | URL;
  /** Headers sent with every request, or a function called before each request. Default: none. */
  readonly headers?: HttpHeaders;
  /** The `fetch` to send with. Default: `globalThis.fetch`, read at send time. */
  readonly fetch?: typeof fetch;
  /** The most events the queue holds at once. A positive integer. Default: 100. */
  readonly maxQueueEvents?: number;
  /** The most estimated bytes the queue holds at once. A positive integer. Default: 1 MiB (1_048_576). */
  readonly maxQueueBytes?: number;
  /** The most events one request carries. A positive integer. Default: 20. */
  readonly maxBatchEvents?: number;
  /** The most estimated bytes one request carries, and the most one event may measure. A positive integer. Default: 65_536. */
  readonly maxBatchBytes?: number;
  /** How long, in milliseconds, a non-full batch waits for more events. Zero sends at the next opportunity. Default: 1000. */
  readonly lingerMs?: number;
  /** The most delivery attempts per batch, the first included. A positive integer. Default: 5. */
  readonly maxAttempts?: number;
  /** The cap, in milliseconds, on both backoff and a `Retry-After` wait. Zero retries with no wait. Default: 30_000. */
  readonly maxDelayMs?: number;
  /**
   * How long, in milliseconds, one delivery attempt — resolving the headers and the `fetch` — may
   * run before it is aborted and counted as a failed attempt. Finite, above zero and at most
   * 2_147_483_647. Default: 10_000.
   */
  readonly requestTimeoutMs?: number;
  /** Turns a batch into the request body. Default: a JSON envelope of the events and the Resource. */
  readonly serialize?: (events: readonly ErrorEvent[], resource: Resource) => string;
  /** The request's `Content-Type`. Default: `application/json`. */
  readonly contentType?: string;
  /** Called with the events the transport gives up on, and why. */
  readonly onDrop?: (events: readonly ErrorEvent[], reason: DropReason) => void;
  /** Where warnings go. Default: `globalThis.console`, read at construction. */
  readonly console?: Pick<Console, "warn">;
  /** The time source for `Retry-After` dates. Default: the system clock. */
  readonly clock?: Clock;
  /** The timer for lingering, backoff and the request timeout. Default: the system scheduler. */
  readonly scheduler?: Scheduler;
  /** The jitter source, returning a number in [0, 1). Default: `Math.random`. */
  readonly random?: () => number;
}

/** {@link HttpTransportOptions} with every default applied and every value validated. */
export interface ResolvedHttpTransportOptions extends QueueLimits {
  /** The endpoint's `href`. */
  readonly url: string;
  readonly headers: HttpHeaders | undefined;
  /** Unresolved when omitted: the transport reads `globalThis.fetch` at send time. */
  readonly fetch: typeof fetch | undefined;
  readonly lingerMs: number;
  readonly maxAttempts: number;
  readonly maxDelayMs: number;
  readonly requestTimeoutMs: number;
  readonly serialize: HttpTransportOptions["serialize"];
  readonly contentType: string;
  readonly onDrop: HttpTransportOptions["onDrop"];
  readonly console: Pick<Console, "warn"> | undefined;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly random: () => number;
}

function describe(value: unknown): string {
  return typeof value === "number" ? String(value) : `of type ${value === null ? "null" : typeof value}`;
}

function positiveInteger(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpTransportConfigError(`Invalid HTTP transport option ${name} ${describe(value)}: expected a positive integer.`);
  }
  return value;
}

function nonNegative(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new HttpTransportConfigError(`Invalid HTTP transport option ${name} ${describe(value)}: expected a finite, non-negative number.`);
  }
  return value;
}

function timeout(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_TIMEOUT_DURATION_MS) {
    throw new HttpTransportConfigError(
      `Invalid HTTP transport option ${name} ${describe(value)}: expected a finite number above zero and at most ${MAX_TIMEOUT_DURATION_MS}.`,
    );
  }
  return value;
}

function optionalFunction<T>(name: string, value: T | undefined): T | undefined {
  if (value !== undefined && typeof value !== "function") {
    throw new HttpTransportConfigError(`Invalid HTTP transport option ${name} ${describe(value)}: expected a function.`);
  }
  return value;
}

function resolveUrl(url: unknown): string {
  if (url === undefined || url === null) {
    throw new HttpTransportConfigError("Invalid HTTP transport option url: it is required.");
  }
  if (typeof url !== "string" && !(url instanceof URL)) {
    throw new HttpTransportConfigError(`Invalid HTTP transport option url ${describe(url)}: expected a string or URL.`);
  }
  try {
    return new URL(url).href;
  } catch {
    throw new HttpTransportConfigError(`Invalid HTTP transport option url "${String(url)}": expected an absolute URL.`);
  }
}

function resolveHeaders(headers: unknown): HttpHeaders | undefined {
  if (headers === undefined || typeof headers === "function") {
    return headers as HttpHeaders | undefined;
  }
  if (typeof headers !== "object" || headers === null) {
    throw new HttpTransportConfigError(`Invalid HTTP transport option headers ${describe(headers)}: expected an object or a function.`);
  }
  return headers as HttpHeaders;
}

/** Applies defaults to `options` and throws {@link HttpTransportConfigError} naming the first invalid one. */
export function resolveOptions(options: HttpTransportOptions): ResolvedHttpTransportOptions {
  return {
    url: resolveUrl(options.url),
    headers: resolveHeaders(options.headers),
    fetch: optionalFunction("fetch", options.fetch),
    maxQueueEvents: positiveInteger("maxQueueEvents", options.maxQueueEvents, 100),
    maxQueueBytes: positiveInteger("maxQueueBytes", options.maxQueueBytes, 1_048_576),
    maxBatchEvents: positiveInteger("maxBatchEvents", options.maxBatchEvents, 20),
    maxBatchBytes: positiveInteger("maxBatchBytes", options.maxBatchBytes, 65_536),
    lingerMs: nonNegative("lingerMs", options.lingerMs, 1000),
    maxAttempts: positiveInteger("maxAttempts", options.maxAttempts, 5),
    maxDelayMs: nonNegative("maxDelayMs", options.maxDelayMs, 30_000),
    requestTimeoutMs: timeout("requestTimeoutMs", options.requestTimeoutMs, 10_000),
    serialize: optionalFunction("serialize", options.serialize),
    contentType: options.contentType ?? "application/json",
    onDrop: optionalFunction("onDrop", options.onDrop),
    console: options.console ?? globalThis.console,
    clock: options.clock ?? systemClock,
    scheduler: options.scheduler ?? systemScheduler,
    random: optionalFunction("random", options.random) ?? Math.random,
  };
}
