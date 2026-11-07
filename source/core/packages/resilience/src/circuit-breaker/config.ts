import type { Clock } from "@vipengele/ts-core-common";
import { ResilienceConfigError } from "../errors";
import { MAX_TIMEOUT_DURATION_MS } from "../timeout";
import type { Outcome } from "../types";
import type { SlidingWindowConfig } from "./sliding-window";

/** The thresholds, window and waits that decide when a circuit breaker opens, half-opens and closes. */
export interface CircuitBreakerConfig {
  /** The failure rate, as a percentage, at or above which the circuit opens; finite, above 0 and at most 100. */
  readonly failureRateThreshold: number;
  /** The outcomes the failure rate is measured over: the last `size` calls, or the last `size` milliseconds. */
  readonly slidingWindow: SlidingWindowConfig;
  /** The calls a closed circuit needs in its window before it may open; an integer of at least 1. */
  readonly minimumCalls: number;
  /** How long an open circuit rejects calls before it admits probes; finite, above 0 and at most {@link MAX_TIMEOUT_DURATION_MS}. */
  readonly waitDurationInOpenMs: number;
  /** The calls a half-open circuit admits, in flight or recorded; an integer of at least 1. */
  readonly permittedCallsInHalfOpen: number;
  /** How long a half-open circuit waits for its probes before it opens again; unset waits indefinitely. */
  readonly maxWaitInHalfOpenMs?: number;
  /** Decides whether an outcome counts as a failure; defaults to `!outcome.ok`. */
  isFailure?(outcome: Outcome<unknown>): boolean;
}

/** The injectable collaborators of a circuit breaker. */
export interface CircuitBreakerDeps {
  /** Stamps each event's `at` and drives time-based windows and waits; defaults to `systemClock`. */
  readonly clock?: Clock;
}

const WAIT_CONSTRAINT = `finite, above 0 and at most ${MAX_TIMEOUT_DURATION_MS}`;

function reject(name: string, key: string, constraint: string, value: unknown): never {
  throw new ResilienceConfigError(`Circuit breaker "${name}" expects ${key} to be ${constraint}, got ${value}`);
}

function isIntegerAtLeastOne(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function isDuration(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_TIMEOUT_DURATION_MS;
}

function validateWindow(name: string, window: SlidingWindowConfig): void {
  const { type, size } = window;
  if (type === "count") {
    if (!isIntegerAtLeastOne(size)) {
      reject(name, "slidingWindow.size", "an integer of at least 1", size);
    }
  } else if (type === "time") {
    if (!isDuration(size)) {
      reject(name, "slidingWindow.size", WAIT_CONSTRAINT, size);
    }
  } else {
    reject(name, "slidingWindow.type", '"count" or "time"', type);
  }
}

function validateWaits(name: string, config: CircuitBreakerConfig): void {
  const { waitDurationInOpenMs, maxWaitInHalfOpenMs } = config;
  if (!isDuration(waitDurationInOpenMs)) {
    // biome-ignore lint/security/noSecrets: a config key name, flagged only for its length and casing
    reject(name, "waitDurationInOpenMs", WAIT_CONSTRAINT, waitDurationInOpenMs);
  }
  if (maxWaitInHalfOpenMs !== undefined && !isDuration(maxWaitInHalfOpenMs)) {
    // biome-ignore lint/security/noSecrets: a config key name, flagged only for its length and casing
    reject(name, "maxWaitInHalfOpenMs", WAIT_CONSTRAINT, maxWaitInHalfOpenMs);
  }
}

function validateCounts(name: string, config: CircuitBreakerConfig): void {
  const { minimumCalls, permittedCallsInHalfOpen, slidingWindow } = config;
  if (!isIntegerAtLeastOne(minimumCalls)) {
    reject(name, "minimumCalls", "an integer of at least 1", minimumCalls);
  }
  if (!isIntegerAtLeastOne(permittedCallsInHalfOpen)) {
    reject(name, "permittedCallsInHalfOpen", "an integer of at least 1", permittedCallsInHalfOpen);
  }
  validateWindow(name, slidingWindow);
  if (slidingWindow.type === "count" && minimumCalls > slidingWindow.size) {
    reject(name, "minimumCalls", `at most the count window size ${slidingWindow.size}`, minimumCalls);
  }
}

/**
 * Throws a {@link ResilienceConfigError} for an empty `name` or a `config` outside the ranges its
 * fields document. A count window smaller than `minimumCalls` is rejected rather than clamped:
 * the circuit could never gather enough calls to open.
 */
export function validateCircuitBreakerConfig(name: string, config: CircuitBreakerConfig): void {
  if (name === "") {
    throw new ResilienceConfigError("A circuit breaker needs a non-empty name");
  }
  const { failureRateThreshold } = config;
  if (!Number.isFinite(failureRateThreshold) || failureRateThreshold <= 0 || failureRateThreshold > 100) {
    reject(name, "failureRateThreshold", "finite, above 0 and at most 100", failureRateThreshold);
  }
  validateCounts(name, config);
  validateWaits(name, config);
}
