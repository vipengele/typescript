import { VipengeleError } from "@vipengele/ts-core-common";
import { describe, expect, test } from "vitest";
import * as errors from "./index";
import {
  BULKHEAD_FULL_ERROR_CODE,
  BulkheadFullError,
  CIRCUIT_OPEN_ERROR_CODE,
  CircuitOpenError,
  isBulkheadFullError,
  isCircuitOpenError,
  isOperationTimeoutError,
  isRateLimitExceededError,
  isResilienceConfigError,
  isResilienceError,
  OPERATION_TIMEOUT_ERROR_CODE,
  OperationTimeoutError,
  RATE_LIMIT_EXCEEDED_ERROR_CODE,
  RESILIENCE_CONFIG_ERROR_CODE,
  RateLimitExceededError,
  ResilienceConfigError,
  ResilienceError,
} from "./resilience-errors";

class OtherError extends VipengeleError {
  readonly code = "other.thing";
}

/** Stands in for a second resolved copy of this package: the right code, an unrelated class identity. */
class ForeignCopy extends Error {
  constructor(readonly code: string) {
    super("foreign");
  }
}

const cases = [
  {
    name: "CircuitOpenError",
    code: CIRCUIT_OPEN_ERROR_CODE,
    literal: "resilience.circuit-open",
    make: () => new CircuitOpenError("open", { circuit: "payments", state: "open" }),
    guard: isCircuitOpenError,
  },
  {
    name: "RateLimitExceededError",
    code: RATE_LIMIT_EXCEEDED_ERROR_CODE,
    literal: "resilience.rate-limit-exceeded",
    make: () => new RateLimitExceededError("limited", { limiter: "api", permits: 1, retryAfterMs: 250 }),
    guard: isRateLimitExceededError,
  },
  {
    name: "BulkheadFullError",
    code: BULKHEAD_FULL_ERROR_CODE,
    literal: "resilience.bulkhead-full",
    make: () => new BulkheadFullError("full", { bulkhead: "db", reason: "full" }),
    guard: isBulkheadFullError,
  },
  {
    name: "OperationTimeoutError",
    code: OPERATION_TIMEOUT_ERROR_CODE,
    literal: "resilience.timeout",
    make: () => new OperationTimeoutError("slow", 50),
    guard: isOperationTimeoutError,
  },
  {
    name: "ResilienceConfigError",
    code: RESILIENCE_CONFIG_ERROR_CODE,
    literal: "resilience.config",
    make: () => new ResilienceConfigError("bad"),
    guard: isResilienceConfigError,
  },
];

describe.each(cases)("$name", ({ code, literal, make, guard }) => {
  test("extends Error, VipengeleError and ResilienceError", () => {
    const error = make();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VipengeleError);
    expect(error).toBeInstanceOf(ResilienceError);
  });

  test("carries a namespaced code", () => {
    expect(make().code).toBe(literal);
    expect(code).toBe(literal);
  });

  test("the guard accepts an instance", () => {
    expect(guard(make())).toBe(true);
  });

  test("the guard accepts a plain Error carrying the code", () => {
    expect(guard(new ForeignCopy(code))).toBe(true);
  });

  test("the guard rejects another code", () => {
    expect(guard(new OtherError("x"))).toBe(false);
    expect(guard(new ForeignCopy("resilience.unknown"))).toBe(false);
  });

  test("the guard rejects non-errors, including an object with the code", () => {
    expect(guard({ code })).toBe(false);
    expect(guard("resilience")).toBe(false);
    expect(guard(null)).toBe(false);
    expect(guard(undefined)).toBe(false);
  });
});

describe("the concrete guards reject each other's errors", () => {
  test.each(cases)("$name is matched by exactly one guard", ({ make, guard }) => {
    const error = make();

    expect(cases.filter((other) => other.guard(error)).map((other) => other.guard)).toEqual([guard]);
  });
});

test("every error keeps its message and cause", () => {
  const cause = new Error("root");
  const raised = [
    new CircuitOpenError("kept", { circuit: "payments", state: "open" }, { cause }),
    new RateLimitExceededError("kept", { limiter: "api", permits: 1, retryAfterMs: 250 }, { cause }),
    new BulkheadFullError("kept", { bulkhead: "db", reason: "full" }, { cause }),
    new OperationTimeoutError("kept", 1, { cause }),
    new ResilienceConfigError("kept", { cause }),
  ];

  for (const error of raised) {
    expect(error.message).toBe("kept");
    expect(error.cause).toBe(cause);
  }
});

describe("CircuitOpenError", () => {
  test("carries the circuit, its state and the time until half-open", () => {
    const error = new CircuitOpenError("open", { circuit: "payments", state: "open", remainingMs: 1500 });

    expect(error.circuit).toBe("payments");
    expect(error.state).toBe("open");
    expect(error.remainingMs).toBe(1500);
  });

  test.each(["open", "half-open", "forced-open"] as const)("carries the %s state", (state) => {
    expect(new CircuitOpenError("refused", { circuit: "c", state }).state).toBe(state);
  });

  test("leaves remainingMs undefined when omitted", () => {
    const error = new CircuitOpenError("refused", { circuit: "c", state: "forced-open" });

    expect(error.remainingMs).toBeUndefined();
  });
});

describe("RateLimitExceededError", () => {
  test("carries the limiter, the permits asked for and the wait until they are available", () => {
    const error = new RateLimitExceededError("limited", { limiter: "api", permits: 3, retryAfterMs: 1200 });

    expect(error.limiter).toBe("api");
    expect(error.permits).toBe(3);
    expect(error.retryAfterMs).toBe(1200);
    expect(error.code).toBe(RATE_LIMIT_EXCEEDED_ERROR_CODE);
    expect(isRateLimitExceededError(error)).toBe(true);
  });

  test("keeps the cause and leaves name to Error", () => {
    const cause = new Error("root");
    const error = new RateLimitExceededError("limited", { limiter: "api", permits: 1, retryAfterMs: 0 }, { cause });

    expect(error.cause).toBe(cause);
    expect(error.name).toBe("Error");
  });
});

describe("BulkheadFullError", () => {
  test.each(["full", "wait-timeout"] as const)("carries the bulkhead and the %s reason", (reason) => {
    const error = new BulkheadFullError("refused", { bulkhead: "db", reason });

    expect(error.bulkhead).toBe("db");
    expect(error.reason).toBe(reason);
    expect(error.code).toBe(BULKHEAD_FULL_ERROR_CODE);
    expect(isBulkheadFullError(error)).toBe(true);
  });

  test("keeps the cause and leaves name to Error", () => {
    const cause = new Error("root");
    const error = new BulkheadFullError("refused", { bulkhead: "db", reason: "full" }, { cause });

    expect(error.cause).toBe(cause);
    expect(error.name).toBe("Error");
  });
});

describe("OperationTimeoutError", () => {
  test("carries the limit it exceeded", () => {
    expect(new OperationTimeoutError("slow", 250).durationMs).toBe(250);
  });

  test("keeps the cause", () => {
    const cause = new Error("root");

    expect(new OperationTimeoutError("slow", 250, { cause }).cause).toBe(cause);
  });
});

describe("isResilienceError", () => {
  test.each(cases)("accepts a $name", ({ make }) => {
    expect(isResilienceError(make())).toBe(true);
  });

  test("accepts a plain Error carrying any resilience. code", () => {
    expect(isResilienceError(new ForeignCopy("resilience.future-kind"))).toBe(true);
  });

  test("rejects another code and a non-string code", () => {
    expect(isResilienceError(new OtherError("x"))).toBe(false);
    expect(isResilienceError(new ForeignCopy("resiliencex"))).toBe(false);
    expect(isResilienceError(new Error("no code"))).toBe(false);
    expect(isResilienceError(Object.assign(new Error("n"), { code: 7 }))).toBe(false);
  });

  test("rejects non-errors, including an object with a resilience. code", () => {
    expect(isResilienceError({ code: "resilience.config" })).toBe(false);
    expect(isResilienceError(null)).toBe(false);
    expect(isResilienceError("resilience.config")).toBe(false);
  });
});

test("every exported *_CODE starts with resilience.", () => {
  const codes = Object.entries(errors)
    .filter(([name]) => name.endsWith("_CODE"))
    .map(([, value]) => value);

  expect(codes).toHaveLength(cases.length);
  for (const code of codes) {
    expect(code).toMatch(/^resilience\./);
  }
});
