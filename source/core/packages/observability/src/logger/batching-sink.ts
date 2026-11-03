import type { Scheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import type { DeliveryLimits } from "../delivery/delivery";
import type { LifecycleTargets } from "../delivery/unload";
import { LoggingConfigError } from "./config-error";
import type { LogRecord, Sink } from "./record";

/** One record and the Resource it was written under; the Resource can differ from entry to entry. */
export interface BatchEntry {
  readonly record: LogRecord;
  readonly resource: Resource;
}

/**
 * A destination that takes many records at once. A returned Promise is awaited before the next batch
 * is handed over; a throw or a rejection drops the batch as `"failed"`.
 */
export interface BatchSink {
  writeBatch(entries: readonly BatchEntry[]): void | Promise<void>;
}

/** Why records left the batching sink without reaching the inner sink. */
export type BatchDropReason = "queue-full" | "failed" | "closed";

/** The limits a batching sink takes from the delivery core, under the same names. */
export type BatchingSinkLimits = Pick<DeliveryLimits, "maxQueueSize" | "maxBatchSize" | "scheduleDelayMs">;

/** How a batching sink buffers, when it hands records on, and how it reports drops. */
export interface BatchingSinkOptions {
  /**
   * Buffer and timing limits over the delivery core's defaults. The sizes are integers of at least
   * 1; the delay is positive and finite.
   */
  readonly limits?: Partial<BatchingSinkLimits>;
  /**
   * Told why records were dropped, how many, and for `"failed"` the error the inner threw or
   * rejected with; a throw is swallowed.
   */
  readonly onDrop?: (reason: BatchDropReason, count: number, error?: unknown) => void;
  /** Supplies the interval timer and the flush deadline; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
  /** Where `pagehide` and `visibilitychange` arrive; detected on `globalThis` when omitted, none watched for `{}`. */
  readonly lifecycle?: LifecycleTargets;
  /**
   * Hands the buffer to the inner on process exit, where the runtime has exit hooks. Defaults to
   * `false`. The exit listener cannot await, so only a synchronous `writeBatch` completes.
   */
  readonly flushOnExit?: boolean;
}

/** A {@link Sink} that hands records on in batches, and can be flushed and closed. */
export type BatchingSink = Sink & {
  /** Hands on everything buffered; resolves `true` once it all settled, `false` on timeout. Never rejects. */
  flush(timeoutMs?: number): Promise<boolean>;
  /** Flushes, drops what is left on timeout as `"closed"`, and turns every later `write` into a drop. Never rejects. */
  close(timeoutMs?: number): Promise<boolean>;
};

const INTEGER_LIMITS = ["maxQueueSize", "maxBatchSize"] as const;

/**
 * Why `options` cannot configure a batching sink, naming the first invalid limit or option, or
 * `undefined` when every one given is valid. The text completes a message that begins
 * "createBatchingSink expects ".
 */
export function batchingSinkOptionsProblem(options: BatchingSinkOptions): string | undefined {
  const { limits = {} } = options;
  const integer = INTEGER_LIMITS.find((name) => !isValidInteger(limits[name]));
  if (integer !== undefined) {
    return `${integer} to be an integer of at least 1, got ${limits[integer]}`;
  }
  if (!isValidDuration(limits.scheduleDelayMs)) {
    return `scheduleDelayMs to be positive and finite, got ${limits.scheduleDelayMs}`;
  }
  return undefined;
}

/** Throws a `LoggingConfigError` when {@link batchingSinkOptionsProblem} finds `options` invalid. */
export function assertBatchingSinkOptions(options: BatchingSinkOptions): void {
  const problem = batchingSinkOptionsProblem(options);
  if (problem !== undefined) {
    throw new LoggingConfigError(`createBatchingSink expects ${problem}`);
  }
}

function hasWriteBatch(inner: BatchSink | Sink): inner is BatchSink {
  return typeof (inner as Partial<BatchSink>).writeBatch === "function";
}

/**
 * The {@link BatchSink} for `inner`: `inner` itself when it has `writeBatch`, even if it also has
 * `write`; otherwise a sink that replays the entries to `inner.write` in order. A throw from
 * `write` drops only that record, reported to `onFailed` with a count of 1 and the error, and the
 * replay continues with the next record.
 */
export function toBatchSink(inner: BatchSink | Sink, onFailed: (count: number, error: unknown) => void): BatchSink {
  if (hasWriteBatch(inner)) {
    return inner;
  }
  return {
    writeBatch(entries) {
      for (const { record, resource } of entries) {
        try {
          inner.write(record, resource);
        } catch (error) {
          onFailed(1, error);
        }
      }
    },
  };
}

function isValidInteger(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 1);
}

function isValidDuration(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value > 0);
}
