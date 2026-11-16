import {
  BulkheadFullError,
  CircuitOpenError,
  OperationTimeoutError,
  type Outcome,
  RateLimitExceededError,
} from "@vipengele/ts-core-resilience";
import { describe, expect, test } from "vitest";
import { createRootContext, type HttpFetch, type HttpRequest } from "../context";
import { HttpConfigError } from "../errors/http-errors";
import { defaultIsFailure, defaultRetryPredicate, HttpResilienceAttributes, RetryNonIdempotent } from "./predicates";

const stubFetch: HttpFetch = async () => new Response("ok");

const makeRequest = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
  url: new URL("https://example.com/a"),
  method: "GET",
  headers: new Headers(),
  ...overrides,
});

const baseContext = (overrides: Partial<HttpRequest> = {}) => createRootContext(makeRequest(overrides), stubFetch);

const thrown = (error: unknown): Outcome<unknown> => ({ ok: false, error });

const responded = (status: number, headers?: HeadersInit): Outcome<unknown> => ({
  ok: true,
  value: new Response(null, { status, headers }),
});

const NOW = Date.parse("2026-11-16T12:00:00Z");
const fixedClock = () => NOW;

describe("symbol keys", () => {
  test("equal their Symbol.for values", () => {
    expect(RetryNonIdempotent).toBe(Symbol.for("vipengele:http:retry-non-idempotent"));
    expect(HttpResilienceAttributes.attempts).toBe(Symbol.for("vipengele:http:resilience-attempts"));
    expect(HttpResilienceAttributes.circuitState).toBe(Symbol.for("vipengele:http:circuit-state"));
  });

  test("HttpResilienceAttributes is frozen", () => {
    expect(Object.isFrozen(HttpResilienceAttributes)).toBe(true);
  });
});

describe("defaultIsFailure", () => {
  test("counts a thrown error as a failure", () => {
    expect(defaultIsFailure(thrown(new Error("boom")))).toBe(true);
  });

  test.each([500, 503, 408, 429])("counts a %i response as a failure", (status) => {
    expect(defaultIsFailure(responded(status))).toBe(true);
  });

  test.each([200, 404])("counts a %i response as a success", (status) => {
    expect(defaultIsFailure(responded(status))).toBe(false);
  });

  test("counts a value that is not a Response as a success", () => {
    expect(defaultIsFailure({ ok: true, value: "text" })).toBe(false);
  });
});

describe("defaultRetryPredicate shouldRetry", () => {
  test("declines a successful outcome", () => {
    expect(defaultRetryPredicate(baseContext()).shouldRetry(responded(200), 1)).toBe(false);
  });

  test("retries a thrown error and a 503 on an idempotent request", () => {
    const { shouldRetry } = defaultRetryPredicate(baseContext());
    expect(shouldRetry(thrown(new TypeError("network")), 1)).toBe(true);
    expect(shouldRetry(responded(503), 1)).toBe(true);
  });

  test.each([
    ["CircuitOpenError", new CircuitOpenError("open", { circuit: "c", state: "open", remainingMs: 10 })],
    ["RateLimitExceededError", new RateLimitExceededError("limited", { limiter: "l", permits: 1, retryAfterMs: 10 })],
    ["BulkheadFullError", new BulkheadFullError("full", { bulkhead: "b", reason: "full" })],
    ["HttpConfigError", new HttpConfigError("sent twice")],
  ])("never retries a %s", (_name, error) => {
    expect(defaultRetryPredicate(baseContext()).shouldRetry(thrown(error), 1)).toBe(false);
  });

  test("retries an OperationTimeoutError", () => {
    const error = new OperationTimeoutError("timed out", 100);
    expect(defaultRetryPredicate(baseContext()).shouldRetry(thrown(error), 1)).toBe(true);
  });

  test("never retries once the caller's signal is aborted", () => {
    const controller = new AbortController();
    const { shouldRetry } = defaultRetryPredicate(baseContext({ signal: controller.signal }));
    expect(shouldRetry(responded(503), 1)).toBe(true);

    controller.abort();
    expect(shouldRetry(responded(503), 1)).toBe(false);
    expect(shouldRetry(thrown(new Error("boom")), 1)).toBe(false);
  });

  test("never retries a request whose body can be sent only once", () => {
    const base = baseContext({ method: "PUT", body: new ReadableStream() });
    expect(defaultRetryPredicate(base).shouldRetry(responded(503), 1)).toBe(false);
  });

  test("retries a request with a replayable body", () => {
    const base = baseContext({ method: "PUT", body: "payload" });
    expect(defaultRetryPredicate(base).shouldRetry(responded(503), 1)).toBe(true);
  });

  test.each(["GET", "HEAD", "OPTIONS", "TRACE", "PUT", "DELETE", "get", "delete"])("retries the idempotent method %s", (method) => {
    expect(defaultRetryPredicate(baseContext({ method })).shouldRetry(responded(503), 1)).toBe(true);
  });

  test.each(["POST", "PATCH", "post"])("does not retry the non-idempotent method %s by default", (method) => {
    expect(defaultRetryPredicate(baseContext({ method })).shouldRetry(responded(503), 1)).toBe(false);
  });

  test("retries a non-idempotent method when the RetryNonIdempotent attribute is true", () => {
    const base = baseContext({ method: "POST" });
    const { shouldRetry } = defaultRetryPredicate(base);

    base.attributes.set(RetryNonIdempotent, "yes");
    expect(shouldRetry(responded(503), 1)).toBe(false);

    base.attributes.set(RetryNonIdempotent, true);
    expect(shouldRetry(responded(503), 1)).toBe(true);
  });

  test("retries a non-idempotent method that carries an Idempotency-Key header", () => {
    const base = baseContext({ method: "POST", headers: new Headers({ "Idempotency-Key": "k-1" }) });
    expect(defaultRetryPredicate(base).shouldRetry(responded(503), 1)).toBe(true);
  });

  test("uses a custom isFailure in place of the default", () => {
    const { shouldRetry } = defaultRetryPredicate(baseContext(), {
      isFailure: (outcome) => outcome.ok && outcome.value instanceof Response && outcome.value.status === 404,
    });
    expect(shouldRetry(responded(404), 1)).toBe(true);
    expect(shouldRetry(responded(503), 1)).toBe(false);
  });
});

describe("Retry-After", () => {
  test("reads delta-seconds as milliseconds", () => {
    const { shouldRetry, retryAfter } = defaultRetryPredicate(baseContext());
    const outcome = responded(503, { "Retry-After": "5" });
    expect(retryAfter(outcome, 1)).toBe(5000);
    expect(shouldRetry(outcome, 1)).toBe(true);
  });

  test("measures an HTTP-date from the injected clock", () => {
    const { retryAfter } = defaultRetryPredicate(baseContext(), { clock: fixedClock });
    const outcome = responded(429, { "Retry-After": new Date(NOW + 7000).toUTCString() });
    expect(retryAfter(outcome, 1)).toBe(7000);
  });

  test("gives 0 for an HTTP-date in the past", () => {
    const { shouldRetry, retryAfter } = defaultRetryPredicate(baseContext(), { clock: fixedClock });
    const outcome = responded(503, { "Retry-After": new Date(NOW - 60_000).toUTCString() });
    expect(retryAfter(outcome, 1)).toBe(0);
    expect(shouldRetry(outcome, 1)).toBe(true);
  });

  test("measures an HTTP-date from the system clock by default", () => {
    const { retryAfter } = defaultRetryPredicate(baseContext());
    const outcome = responded(503, { "Retry-After": "Thu, 01 Jan 1970 00:00:00 GMT" });
    expect(retryAfter(outcome, 1)).toBe(0);
  });

  test.each(["soon", "1.5", "-3", "", "Funday, 99 Nonuary"])(
    "falls back to the backoff for the unparsable value %j and still retries",
    (value) => {
      const { shouldRetry, retryAfter } = defaultRetryPredicate(baseContext());
      const outcome = responded(503, { "Retry-After": value });
      expect(retryAfter(outcome, 1)).toBeUndefined();
      expect(shouldRetry(outcome, 1)).toBe(true);
    },
  );

  test("gives undefined without a Retry-After header or a Response", () => {
    const { retryAfter } = defaultRetryPredicate(baseContext());
    expect(retryAfter(responded(503), 1)).toBeUndefined();
    expect(retryAfter(thrown(new Error("boom")), 1)).toBeUndefined();
    expect(retryAfter({ ok: true, value: "text" }, 1)).toBeUndefined();
  });

  test("stops retrying when the delay exceeds the default 30 s cap, leaving the header intact", () => {
    const { shouldRetry, retryAfter } = defaultRetryPredicate(baseContext());
    const atCap = responded(503, { "Retry-After": "30" });
    const overCap = responded(503, { "Retry-After": "31" });

    expect(shouldRetry(atCap, 1)).toBe(true);
    expect(retryAfter(atCap, 1)).toBe(30_000);
    expect(shouldRetry(overCap, 1)).toBe(false);
    expect(retryAfter(overCap, 1)).toBeUndefined();
    expect(overCap.ok && (overCap.value as Response).headers.get("retry-after")).toBe("31");
  });

  test("applies a custom maxRetryAfterMs to delta-seconds and HTTP-dates alike", () => {
    const { shouldRetry, retryAfter } = defaultRetryPredicate(baseContext(), { clock: fixedClock, maxRetryAfterMs: 2000 });

    expect(shouldRetry(responded(503, { "Retry-After": "2" }), 1)).toBe(true);
    expect(shouldRetry(responded(503, { "Retry-After": "3" }), 1)).toBe(false);

    const farDate = responded(503, { "Retry-After": new Date(NOW + 5000).toUTCString() });
    expect(shouldRetry(farDate, 1)).toBe(false);
    expect(retryAfter(farDate, 1)).toBeUndefined();
  });
});
