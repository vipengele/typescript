import type { Level } from "./level";

/** An OpenTelemetry log severity number, the first of each four-wide band. */
export type SeverityNumber = 1 | 5 | 9 | 13 | 17 | 21;

/** The OpenTelemetry severity number of each `Level`. */
export const SEVERITY_NUMBERS = Object.freeze({
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
} as const satisfies Record<Level, SeverityNumber>);

/**
 * Whether `value` is one of the six `Level` strings. Own-property lookup, so inherited names such
 * as `"constructor"` and the `"off"` threshold are not levels.
 */
export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && Object.hasOwn(SEVERITY_NUMBERS, value);
}
