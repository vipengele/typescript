import { VipengeleError } from "@vipengele/ts-core-common";

/** Every {@link ResilienceError} code starts with this prefix, and {@link isResilienceError} matches on it. */
const RESILIENCE_CODE_PREFIX = "resilience.";

/** The `code` every {@link CircuitOpenError} carries. */
export const CIRCUIT_OPEN_ERROR_CODE = "resilience.circuit-open";

/** The `code` every {@link RateLimitExceededError} carries. */
export const RATE_LIMIT_EXCEEDED_ERROR_CODE = "resilience.rate-limit-exceeded";

/** The `code` every {@link BulkheadFullError} carries. */
export const BULKHEAD_FULL_ERROR_CODE = "resilience.bulkhead-full";

/** The `code` every {@link OperationTimeoutError} carries. */
export const OPERATION_TIMEOUT_ERROR_CODE = "resilience.timeout";

/** The `code` every {@link ResilienceConfigError} carries. */
export const RESILIENCE_CONFIG_ERROR_CODE = "resilience.config";

/** The base of every error this package raises; each concrete error fixes its own `resilience.*` code. */
export abstract class ResilienceError extends VipengeleError {}

/** Raised when a call is refused because the circuit is open. */
export class CircuitOpenError extends ResilienceError {
  readonly code = CIRCUIT_OPEN_ERROR_CODE;
}

/** Raised when a call is refused because the rate limit is exhausted. */
export class RateLimitExceededError extends ResilienceError {
  readonly code = RATE_LIMIT_EXCEEDED_ERROR_CODE;
}

/** Raised when a call is refused because the bulkhead has no free slot. */
export class BulkheadFullError extends ResilienceError {
  readonly code = BULKHEAD_FULL_ERROR_CODE;
}

/** Raised when an operation does not settle within its time limit. */
export class OperationTimeoutError extends ResilienceError {
  readonly code = OPERATION_TIMEOUT_ERROR_CODE;

  /** The limit, in milliseconds, the operation exceeded. */
  readonly durationMs: number;

  constructor(message: string, durationMs: number, options?: ErrorOptions) {
    super(message, options);
    this.durationMs = durationMs;
  }
}

/** Raised when a resilience policy's configuration is invalid. */
export class ResilienceConfigError extends ResilienceError {
  readonly code = RESILIENCE_CONFIG_ERROR_CODE;
}

/**
 * Narrows `value` to any error this package raises.
 *
 * Matches the `resilience.` prefix of `code`, so a new concrete error is covered without touching
 * the guard. Like every guard here it never uses `instanceof` on a package class: two resolved
 * copies of the package give the same source two class identities.
 */
export function isResilienceError(value: unknown): value is ResilienceError {
  if (!(value instanceof Error)) {
    return false;
  }
  const { code } = value as Partial<VipengeleError>;
  return typeof code === "string" && code.startsWith(RESILIENCE_CODE_PREFIX);
}

/** Narrows `value` to a {@link CircuitOpenError}; matches on `code`, not class identity. */
export function isCircuitOpenError(value: unknown): value is CircuitOpenError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === CIRCUIT_OPEN_ERROR_CODE;
}

/** Narrows `value` to a {@link RateLimitExceededError}; matches on `code`, not class identity. */
export function isRateLimitExceededError(value: unknown): value is RateLimitExceededError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === RATE_LIMIT_EXCEEDED_ERROR_CODE;
}

/** Narrows `value` to a {@link BulkheadFullError}; matches on `code`, not class identity. */
export function isBulkheadFullError(value: unknown): value is BulkheadFullError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === BULKHEAD_FULL_ERROR_CODE;
}

/** Narrows `value` to an {@link OperationTimeoutError}; matches on `code`, not class identity. */
export function isOperationTimeoutError(value: unknown): value is OperationTimeoutError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === OPERATION_TIMEOUT_ERROR_CODE;
}

/** Narrows `value` to a {@link ResilienceConfigError}; matches on `code`, not class identity. */
export function isResilienceConfigError(value: unknown): value is ResilienceConfigError {
  return value instanceof Error && (value as Partial<VipengeleError>).code === RESILIENCE_CONFIG_ERROR_CODE;
}
