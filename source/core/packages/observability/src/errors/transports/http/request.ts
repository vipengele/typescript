import { VipengeleError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { createRetry, exponentialBackoff, type Outcome, type RetryPolicy, withJitter } from "@vipengele/ts-core-resilience/retry";
import { createTimeout, type TimeoutPolicy } from "@vipengele/ts-core-resilience/timeout";
import { suppressBreadcrumbs } from "../../../breadcrumb-suppression";
import type { ErrorEvent } from "../../event";
import { classify } from "./classify";
import type { ResolvedHttpTransportOptions } from "./options";
import type { Batch, DropReason } from "./queue";
import { parseRetryAfter } from "./retry-after";

/** The delay after the first failed attempt; each further one doubles it, up to `maxDelayMs`. */
const INITIAL_BACKOFF_MS = 1000;

/** The drop reasons a request settles with; the queue and the transport's close own the rest. */
export type RequestDropReason = Extract<DropReason, "rejected" | "retries-exhausted" | "unsendable" | "too-large">;

/**
 * How a group of events from one batch settled: `"delivered"` when the endpoint accepted them,
 * `"aborted"` when the signal aborted before they settled otherwise, or the reason they were dropped.
 */
export type RequestOutcome = "delivered" | "aborted" | RequestDropReason;

/** A group of a batch's events, in their original order, and how they settled. */
export interface Settlement {
  readonly events: ErrorEvent[];
  readonly outcome: RequestOutcome;
  /** The request body every attempt sent, on a `"retries-exhausted"` group only. */
  readonly body?: string;
}

/** {@link ResolvedHttpTransportOptions} with the transport's internal hooks. */
export interface RequestOptions extends ResolvedHttpTransportOptions {
  /**
   * Read after an attempt fails with a network error or a timeout; `true` settles the group
   * `"retries-exhausted"` at once, with no backoff and no further attempt. A retryable status is
   * retried regardless. Defaults to never offline.
   */
  readonly isOffline?: () => boolean;
}

/** A group of a batch's events and its request body, or `undefined` when it has none to send. */
export interface EncodedGroup {
  readonly events: ErrorEvent[];
  readonly body: string | undefined;
}

/**
 * Every event of one batch, each in exactly one settlement, in batch order. A batch split for size
 * settles as several groups, which may settle differently.
 */
export type RequestResult = readonly Settlement[];

/** Told of each group of a batch as it settles, in batch order, before `sendBatch` resolves. */
export type SettlementListener = (settlement: Settlement) => void;

const RETRYABLE_STATUS_ERROR_CODE = "observability.errors.http-transport.retryable-status";

/** A response worth retrying, thrown so the retry policy sees it as a failed attempt. */
class RetryableStatusError extends VipengeleError {
  readonly code = RETRYABLE_STATUS_ERROR_CODE;

  constructor(
    readonly status: number,
    /** The response's `Retry-After` header, or `null` when it has none. */
    readonly retryAfter: string | null,
  ) {
    super(`The endpoint answered ${status}`);
  }
}

function isRetryableStatusError(value: unknown): value is RetryableStatusError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === RETRYABLE_STATUS_ERROR_CODE;
}

const encoder = new TextEncoder();

/** The Resource with every key that holds no value left out. */
function definedKeys(resource: Resource): Record<string, string> {
  return Object.fromEntries(Object.entries(resource).filter(([, value]) => value !== undefined));
}

function defaultSerialize(events: readonly ErrorEvent[], resource: Resource): string {
  return JSON.stringify({ resource: definedKeys(resource), events });
}

/**
 * How `events` encode: one body within `maxBatchBytes`, `"split"` for several events over it, or why
 * they cannot be sent — the serializer threw, or a lone event is over it.
 */
type Encoding = { readonly body: string } | "split" | "unsendable" | "too-large";

/** The request body `events` and their Resource serialize to. Throws whatever the serializer throws. */
export function serializeEvents(options: ResolvedHttpTransportOptions, events: readonly ErrorEvent[], resource: Resource): string {
  return (options.serialize ?? defaultSerialize)(events, resource);
}

function encodeGroup(options: ResolvedHttpTransportOptions, events: ErrorEvent[], resource: Resource): Encoding {
  let body: string;
  try {
    body = serializeEvents(options, events, resource);
  } catch {
    return "unsendable";
  }
  if (encoder.encode(body).byteLength <= options.maxBatchBytes) {
    return { body };
  }
  return events.length === 1 ? "too-large" : "split";
}

/** The two halves a group over `maxBatchBytes` is split into, the first holding the odd event. */
function halves(events: ErrorEvent[]): [ErrorEvent[], ErrorEvent[]] {
  const middle = Math.ceil(events.length / 2);
  return [events.slice(0, middle), events.slice(middle)];
}

function collect(options: ResolvedHttpTransportOptions, events: ErrorEvent[], resource: Resource, groups: EncodedGroup[]): void {
  const encoding = encodeGroup(options, events, resource);
  if (encoding === "split") {
    for (const half of halves(events)) {
      collect(options, half, resource, groups);
    }
    return;
  }
  groups.push({ events, body: typeof encoding === "string" ? undefined : encoding.body });
}

/**
 * The request bodies `sendBatch` would send for `batch`, without sending any: serialized and split
 * in half, recursively, exactly as a request splits a body over `maxBatchBytes`. A group the
 * serializer throws on, or a lone event over the limit, has no body.
 */
export function encodeBatch(batch: Batch, options: ResolvedHttpTransportOptions): EncodedGroup[] {
  const groups: EncodedGroup[] = [];
  collect(options, batch.events, batch.resource, groups);
  return groups;
}

/** Whether a failed attempt is retried: a retryable status always is, any other failure unless the network is down. */
function retriesAfter(error: unknown, isOffline: () => boolean): boolean {
  return isRetryableStatusError(error) || !isOffline();
}

function never(): boolean {
  return false;
}

function createPolicy(options: RequestOptions): RetryPolicy {
  const { maxAttempts, maxDelayMs, random, clock, scheduler } = options;
  const isOffline = options.isOffline ?? never;
  return createRetry(
    "http-transport",
    {
      maxAttempts,
      backoff: withJitter(exponentialBackoff({ initialMs: INITIAL_BACKOFF_MS, maxMs: maxDelayMs }), "full", random),
      // A rejected status resolves the attempt rather than throwing, so every failure is retryable.
      shouldRetry: (outcome) => !outcome.ok && retriesAfter(outcome.error, isOffline),
      retryAfter: (outcome) => {
        // shouldRetry declines every ok outcome, so only a failed one reaches here.
        const { error } = outcome as Extract<Outcome<unknown>, { ok: false }>;
        if (!isRetryableStatusError(error)) {
          return undefined;
        }
        const delayMs = parseRetryAfter(error.retryAfter, clock());
        return delayMs === undefined ? undefined : Math.min(delayMs, maxDelayMs);
      },
    },
    { clock, scheduler },
  );
}

function createAttemptTimeout(options: ResolvedHttpTransportOptions): TimeoutPolicy {
  const { requestTimeoutMs, clock, scheduler } = options;
  return createTimeout("http-transport", { durationMs: requestTimeoutMs }, { clock, scheduler });
}

interface RequestContext {
  readonly options: ResolvedHttpTransportOptions;
  readonly send: typeof fetch;
  readonly policy: RetryPolicy;
  readonly timeout: TimeoutPolicy;
  readonly signal: AbortSignal | undefined;
  readonly settlements: Settlement[];
  readonly onSettle: SettlementListener | undefined;
}

function record(context: RequestContext, events: ErrorEvent[], outcome: RequestOutcome, body?: string): void {
  const settlement: Settlement = body === undefined ? { events, outcome } : { events, outcome, body };
  context.settlements.push(settlement);
  context.onSettle?.(settlement);
}

/** `configured` with `Content-Type` set to the transport's `contentType`. */
function withContentType(options: ResolvedHttpTransportOptions, configured: Record<string, string> | undefined): Headers {
  const headers = new Headers(configured);
  headers.set("Content-Type", options.contentType);
  return headers;
}

async function resolveHeaders(options: ResolvedHttpTransportOptions): Promise<Headers> {
  const { headers } = options;
  return withContentType(options, typeof headers === "function" ? await headers() : headers);
}

/**
 * POSTs `body` until it is delivered, rejected, the retries run out or the signal aborts. Headers
 * are resolved per attempt; a throwing or rejecting headers function, a throwing or rejecting
 * `fetch`, a retryable status and an attempt outliving `requestTimeoutMs` are each a failed
 * attempt. A timed-out attempt's `fetch` is aborted, and a headers promise that never settles is
 * abandoned.
 */
async function deliver(context: RequestContext, body: string): Promise<RequestOutcome> {
  const { options, send, policy, timeout, signal } = context;
  try {
    return await policy.execute(
      (attempt) =>
        timeout.execute(
          async (bounded) => {
            const headers = await resolveHeaders(options);
            const response = await suppressBreadcrumbs(() => send(options.url, { method: "POST", headers, body, signal: bounded.signal }));
            const status = classify(response.status);
            if (status === "retry") {
              throw new RetryableStatusError(response.status, response.headers.get("Retry-After"));
            }
            return status;
          },
          { signal: attempt.signal },
        ),
      { signal },
    );
  } catch {
    return signal?.aborted ? "aborted" : "retries-exhausted";
  }
}

/**
 * Serializes and measures `events` once, then delivers them, or splits them in half and settles
 * each half in turn when the body exceeds `maxBatchBytes`.
 */
async function settle(context: RequestContext, events: ErrorEvent[], resource: Resource): Promise<void> {
  if (context.signal?.aborted) {
    record(context, events, "aborted");
    return;
  }
  const encoding = encodeGroup(context.options, events, resource);
  if (encoding === "split") {
    for (const half of halves(events)) {
      await settle(context, half, resource);
    }
    return;
  }
  if (typeof encoding === "string") {
    record(context, events, encoding);
    return;
  }
  const outcome = await deliver(context, encoding.body);
  record(context, events, outcome, outcome === "retries-exhausted" ? encoding.body : undefined);
}

/**
 * Sends one batch to `options.url` and reports how each of its events settled. Never rejects.
 *
 * `fetch` is `options.fetch`, else `globalThis.fetch` read now; with neither, the whole batch is
 * `"unsendable"`, as is any group the serializer throws on. A body over `maxBatchBytes` is split in
 * half, recursively, and a lone event over it is `"too-large"`. A 2xx is `"delivered"`; 408, 429,
 * 5xx and a network error are retried with full-jitter exponential backoff, or the response's
 * `Retry-After`, each capped at `maxDelayMs`, and settle `"retries-exhausted"`, carrying the body,
 * after `maxAttempts`, or at once on a network error or timeout while `options.isOffline` reports
 * `true`; any other status is `"rejected"` at once. An attempt still unanswered after
 * `requestTimeoutMs`, timed on the Scheduler, has its `fetch` aborted and is retried like a network
 * error. Aborting `signal` stops the request and the wait between attempts, and every group not
 * yet settled is `"aborted"`.
 *
 * `onSettle` hears each group the moment it settles, so a caller learns of a half already
 * delivered while the other half is still being sent.
 */
export async function sendBatch(
  batch: Batch,
  options: RequestOptions,
  signal?: AbortSignal,
  onSettle?: SettlementListener,
): Promise<RequestResult> {
  const send = options.fetch ?? globalThis.fetch;
  const context: RequestContext = {
    options,
    send,
    policy: createPolicy(options),
    timeout: createAttemptTimeout(options),
    signal,
    settlements: [],
    onSettle,
  };
  if (typeof send !== "function") {
    record(context, batch.events, "unsendable");
    return context.settlements;
  }
  await settle(context, batch.events, batch.resource);
  return context.settlements;
}

type ConfiguredHeaders = Record<string, string> | Promise<Record<string, string>> | undefined;

function isThenable(value: ConfiguredHeaders): value is Promise<Record<string, string>> {
  return typeof (value as Partial<PromiseLike<unknown>> | undefined)?.then === "function";
}

function ignore(): void {}

/**
 * POSTs `body` once to `options.url` with `keepalive`, so the request outlives the page, and with
 * the configured headers and `contentType`. Nothing waits for the request and nothing reports its
 * outcome: a throw or rejection from `fetch` is swallowed. Headers from a function are read once;
 * a promise of them delays the request until it resolves, and a rejected one sends nothing.
 * Returns `false`, having sent nothing, when there is no `fetch` or the headers function throws.
 */
export function sendKeepalive(options: ResolvedHttpTransportOptions, body: string): boolean {
  const send = options.fetch ?? globalThis.fetch;
  if (typeof send !== "function") {
    return false;
  }
  let configured: ConfiguredHeaders;
  try {
    configured = typeof options.headers === "function" ? options.headers() : options.headers;
  } catch {
    return false;
  }
  const post = (headers: Record<string, string> | undefined): Promise<Response> =>
    suppressBreadcrumbs(() => send(options.url, { method: "POST", headers: withContentType(options, headers), body, keepalive: true }));
  if (isThenable(configured)) {
    Promise.resolve(configured).then(post).catch(ignore);
    return true;
  }
  try {
    Promise.resolve(post(configured)).catch(ignore);
  } catch {
    // A page going away leaves nobody to report a request that could not be made to.
  }
  return true;
}
