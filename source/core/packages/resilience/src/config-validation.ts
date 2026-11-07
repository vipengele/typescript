import { ResilienceConfigError } from "./errors";
import { MAX_TIMEOUT_DURATION_MS } from "./timeout";

/** The constraint text for a duration accepted by {@link isDuration}. */
export const DURATION_CONSTRAINT = `finite, above 0 and at most ${MAX_TIMEOUT_DURATION_MS}`;

/** Throws a {@link ResilienceConfigError} reading `<label> "<name>" expects <key> to be <constraint>, got <value>`. */
export function reject(label: string, name: string, key: string, constraint: string, value: unknown): never {
  throw new ResilienceConfigError(`${label} "${name}" expects ${key} to be ${constraint}, got ${value}`);
}

/** Whether `value` is an integer of at least 1. */
export function isIntegerAtLeastOne(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/** Whether `value` is finite, above 0 and at most {@link MAX_TIMEOUT_DURATION_MS}. */
export function isDuration(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_TIMEOUT_DURATION_MS;
}
