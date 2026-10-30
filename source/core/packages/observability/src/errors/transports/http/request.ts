import { VipengeleError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { createRetry, exponentialBackoff, type Outcome, type RetryPolicy, withJitter } from "@vipengele/ts-core-resilience/retry";
import { createTimeout, type TimeoutPolicy } from "@vipengele/ts-core-resilience/timeout";
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

function createPolicy(options: ResolvedHttpTransportOptions): RetryPolicy {
  const { maxAttempts, maxDelayMs, random, clock, scheduler } = options;
  return createRetry(
    "http-transport",
    {
      maxAttempts,
      backoff: withJitter(exponentialBackoff({ initialMs: INITIAL_BACKOFF_MS, maxMs: maxDelayMs }), "full", random),
      // A rejected status resolves the attempt rather than throwing, so every failure is retryable.
      shouldRetry: (outcome) => !outcome.ok,
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
  readonly serialize: (events: readonly ErrorEvent[], resource: Resource) => string;
  readonly policy: RetryPolicy;
  readonly timeout: TimeoutPolicy;
  readonly signal: AbortSignal | undefined;
  readonly settlements: Settlement[];
  readonly onSettle: SettlementListener | undefined;
}

function record(context: RequestContext, events: ErrorEvent[], outcome: RequestOutcome): void {
  const settlement: Settlement = { events, outcome };
  context.settlements.push(settlement);
  context.onSettle?.(settlement);
}

async function resolveHeaders(options: ResolvedHttpTransportOptions): Promise<Headers> {
  const { headers } = options;
  const resolved = new Headers(typeof headers === "function" ? await headers() : headers);
  resolved.set("Content-Type", options.contentType);
  return resolved;
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
            const response = await send(options.url, { method: "POST", headers, body, signal: bounded.signal });
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
  let body: string;
  try {
    body = context.serialize(events, resource);
  } catch {
    record(context, events, "unsendable");
    return;
  }
  if (encoder.encode(body).byteLength > context.options.maxBatchBytes) {
    if (events.length === 1) {
      record(context, events, "too-large");
      return;
    }
    const middle = Math.ceil(events.length / 2);
    await settle(context, events.slice(0, middle), resource);
    await settle(context, events.slice(middle), resource);
    return;
  }
  record(context, events, await deliver(context, body));
}

/**
 * Sends one batch to `options.url` and reports how each of its events settled. Never rejects.
 *
 * `fetch` is `options.fetch`, else `globalThis.fetch` read now; with neither, the whole batch is
 * `"unsendable"`, as is any group the serializer throws on. A body over `maxBatchBytes` is split in
 * half, recursively, and a lone event over it is `"too-large"`. A 2xx is `"delivered"`; 408, 429,
 * 5xx and a network error are retried with full-jitter exponential backoff, or the response's
 * `Retry-After`, each capped at `maxDelayMs`, and settle `"retries-exhausted"` after
 * `maxAttempts`; any other status is `"rejected"` at once. An attempt still unanswered after
 * `requestTimeoutMs`, timed on the Scheduler, has its `fetch` aborted and is retried like a network
 * error. Aborting `signal` stops the request and the wait between attempts, and every group not
 * yet settled is `"aborted"`.
 *
 * `onSettle` hears each group the moment it settles, so a caller learns of a half already
 * delivered while the other half is still being sent.
 */
export async function sendBatch(
  batch: Batch,
  options: ResolvedHttpTransportOptions,
  signal?: AbortSignal,
  onSettle?: SettlementListener,
): Promise<RequestResult> {
  const send = options.fetch ?? globalThis.fetch;
  const context: RequestContext = {
    options,
    send,
    serialize: options.serialize ?? defaultSerialize,
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
