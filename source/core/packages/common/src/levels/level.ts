/**
 * The severity of a log record or an error event, each at the base of its OpenTelemetry severity
 * range (ADR-0007). Nothing sits between two levels, and a presentational kind is an attribute a
 * formatter styles, not a level.
 */
export type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * The lowest level a logger or sink lets through. `off` exists only here: no record is `off`, no
 * sink handles it, and a threshold of `off` silences `warn` and `error` too.
 */
export type Threshold = Level | "off";
