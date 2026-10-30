import type { Level } from "@vipengele/ts-core-common";

/**
 * Each Level's OTLP `SeverityNumber`: the base of its OpenTelemetry severity range (ADR-0007), so
 * nothing between two levels is ever sent.
 */
const SEVERITY_NUMBERS: Readonly<Record<Level, number>> = Object.freeze({
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
});

/** An OTLP log record's severity: its `severityNumber`, and its `severityText`, the Level's own name. */
export interface Severity {
  readonly severityNumber: number;
  readonly severityText: Level;
}

/** The OTLP severity of `level` (ADR-0007). */
export function severityOf(level: Level): Severity {
  return { severityNumber: SEVERITY_NUMBERS[level], severityText: level };
}
