import type { Attributes, Level, SerializedError } from "@vipengele/ts-core-common";

/**
 * A captured exception or message, ready for a Reporter transport (ADR-0007). Shares its error
 * shape, its attribute type and its level type with the logger, through one normalizer for both.
 */
export interface ErrorEvent {
  /** 32 hex characters, generated at capture so a dedup key and a report ID shown to a user agree. */
  id: string;
  /** Epoch ms with a sub-ms fraction, from an injectable clock. */
  time: number;
  /** `"error"` unless the process is going down. */
  level: Level;
  /** Present for a captured message; absent when `exception` carries the text instead. */
  message?: string;
  /** Absent only for a captured message. */
  exception?: ExceptionRecord;
  mechanism: Mechanism;
  /**
   * The ambient Scope chain's attributes, from the default scope inward and never the Resource,
   * beneath the call's own attributes, the call's winning on a shared key.
   */
  attributes: Attributes;
  fingerprint?: string[];
  trace?: { traceId: string; spanId: string; flags: number };
}

/**
 * A {@link SerializedError} plus parsed stack frames. Stack parsing stays in the reporter, so
 * anything that reads a `SerializedError` reads an Error Event's exception without translation.
 */
export interface ExceptionRecord extends SerializedError {
  frames: StackFrame[];
  cause?: ExceptionRecord;
  errors?: ExceptionRecord[];
}

/** Separates whether the application caught the error from who handed it to the reporter. */
export interface Mechanism {
  /** Did the application catch it. */
  handled: boolean;
  /** Who handed it to the reporter; an integration uses `integration.<name>` without a type change. */
  source: "capture" | "logger" | "global.error" | "global.rejection" | "console" | "network" | `integration.${string}`;
  data?: Attributes;
}

/**
 * One parsed frame of an {@link ExceptionRecord}'s stack. `ExceptionRecord.frames` keeps the
 * engine's order: `frames[0]` is the throw site.
 */
export interface StackFrame {
  function?: string;
  file?: string;
  line?: number;
  column?: number;
  /** The frame is the application's own code, not a dependency, a runtime builtin or an unknown file. */
  inApp?: boolean;
}
