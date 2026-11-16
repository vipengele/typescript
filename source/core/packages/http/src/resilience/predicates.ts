import { type Clock, systemClock } from "@vipengele/ts-core-common";
import { isBulkheadFullError, isCircuitOpenError, isRateLimitExceededError, type Outcome } from "@vipengele/ts-core-resilience";
import type { HttpContext } from "../context";
import { isHttpConfigError } from "../errors/http-errors";

/**
 * The attribute key that opts a call with a non-idempotent method into retries: set it to `true`
 * on the context's `attributes` when the server is known to tolerate a repeated request.
 */
export const RetryNonIdempotent: unique symbol = Symbol.for("vipengele:http:retry-non-idempotent");

/** The attribute keys the resilience filters record their state under, for filters further out to read. */
export const HttpResilienceAttributes: { readonly attempts: symbol; readonly circuitState: symbol } = Object.freeze({
  attempts: Symbol.for("vipengele:http:resilience-attempts"),
  circuitState: Symbol.for("vipengele:http:circuit-state"),
});

/** The longest `Retry-After` delay a retry waits for by default; a longer one ends the retries. */
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;

/** The methods RFC 9110 defines as idempotent; a repeat of one has the effect of a single request. */
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS", "TRACE", "PUT", "DELETE"]);

const DELTA_SECONDS = /^\d+$/;

/** Every HTTP-date form names a weekday or a month; a value without a letter is never one. */
const HAS_LETTER = /[A-Za-z]/;

/**
 * Whether `outcome` counts as a failure: a thrown error, or a `Response` with a 5xx, 408 (Request
 * Timeout) or 429 (Too Many Requests) status.
 */
export function defaultIsFailure(outcome: Outcome<unknown>): boolean {
  if (!outcome.ok) {
    return true;
  }
  const { value } = outcome;
  if (!(value instanceof Response)) {
    return false;
  }
  return value.status >= 500 || value.status === 408 || value.status === 429;
}

export interface RetryPredicateOptions {
  /** The time an HTTP-date `Retry-After` is measured from. Defaults to `systemClock`. */
  clock?: Clock;
  /** The longest `Retry-After` delay worth waiting for; a longer one ends the retries. Defaults to 30 000 ms. */
  maxRetryAfterMs?: number;
  /** Whether `outcome` is a failure worth retrying at all. Defaults to {@link defaultIsFailure}. */
  isFailure?(outcome: Outcome<unknown>): boolean;
}

/** The `shouldRetry` and `retryAfter` pair a retry policy takes, bound to one call. */
export interface RetryPredicate {
  shouldRetry(outcome: Outcome<unknown>, attempt: number): boolean;
  retryAfter(outcome: Outcome<unknown>, attempt: number): number | undefined;
}

/**
 * The delay in milliseconds a `Response` outcome's `Retry-After` header asks for: delta-seconds, or
 * an HTTP-date measured from `clock` and clamped at 0 once past. `undefined` when the outcome is not
 * a `Response` or the header is absent or unparsable.
 */
function requestedDelay(outcome: Outcome<unknown>, clock: Clock): number | undefined {
  if (!outcome.ok || !(outcome.value instanceof Response)) {
    return undefined;
  }
  const header = outcome.value.headers.get("retry-after")?.trim();
  if (header === undefined || header.length === 0) {
    return undefined;
  }
  if (DELTA_SECONDS.test(header)) {
    return Number(header) * 1000;
  }
  if (!HAS_LETTER.test(header)) {
    return undefined;
  }
  const at = Date.parse(header);
  if (Number.isNaN(at)) {
    return undefined;
  }
  return Math.max(0, at - clock());
}

function isRefusal(error: unknown): boolean {
  return isCircuitOpenError(error) || isRateLimitExceededError(error) || isBulkheadFullError(error) || isHttpConfigError(error);
}

/** Whether repeating `base`'s request is safe: an idempotent method, or one the caller opted in. */
function isRepeatable(base: HttpContext): boolean {
  if (IDEMPOTENT_METHODS.has(base.request.method.toUpperCase())) {
    return true;
  }
  return base.attributes.get(RetryNonIdempotent) === true || base.request.headers.has("idempotency-key");
}

/**
 * Builds the retry predicates for one call from its root context.
 *
 * `shouldRetry` retries a failure (per `isFailure`) only when every one of these holds: it is not a
 * refusal from another policy (`CircuitOpenError`, `RateLimitExceededError`, `BulkheadFullError`) or
 * an `HttpConfigError`; the caller's signal is not aborted; the request body can be sent again; the
 * method is idempotent, or the call opted in through {@link RetryNonIdempotent} or an
 * `Idempotency-Key` header; and no `Retry-After` asks for longer than `maxRetryAfterMs`, in which
 * case the caller receives that `Response` as it is. An `OperationTimeoutError` is retried like any
 * other failure. Abort, replayability, method and attributes are read from `base` at each call.
 *
 * `retryAfter` returns the `Retry-After` delay within the cap, and `undefined` otherwise, so the
 * retry falls back to its backoff.
 */
export function defaultRetryPredicate(base: HttpContext, options: RetryPredicateOptions = {}): RetryPredicate {
  const clock = options.clock ?? systemClock;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
  const isFailure = options.isFailure ?? defaultIsFailure;

  return {
    shouldRetry(outcome) {
      if (!isFailure(outcome)) {
        return false;
      }
      if (!outcome.ok && isRefusal(outcome.error)) {
        return false;
      }
      if (base.request.signal?.aborted === true || !base.replayable || !isRepeatable(base)) {
        return false;
      }
      const delay = requestedDelay(outcome, clock);
      return delay === undefined || delay <= maxRetryAfterMs;
    },
    retryAfter(outcome) {
      const delay = requestedDelay(outcome, clock);
      return delay !== undefined && delay <= maxRetryAfterMs ? delay : undefined;
    },
  };
}
