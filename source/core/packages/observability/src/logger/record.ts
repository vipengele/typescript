import type { Attributes, Clock, Level, SerializedError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import type { RedactionSetting } from "../redaction";

/**
 * One emitted log entry, the shape every {@link Sink} receives (ADR-0007). Its attributes merge
 * from least to most specific (ADR-0006): the current Scope's attributes, then the bindings of the
 * Logger that emitted it, then the attributes of the call, so a key the call passes always wins.
 */
export interface LogRecord {
  /** Epoch milliseconds with a sub-millisecond fraction, read from the {@link Clock} in force. */
  readonly time: number;
  readonly level: Level;
  /** The Category of the Logger that emitted the record. */
  readonly category: string;
  readonly message: string;
  /**
   * The call's attributes over the Logger's bindings over the current Scope's attributes,
   * redacted when a {@link RedactionSetting} policy is in force.
   */
  readonly attributes: Attributes;
  /** The thrown value passed to the call, with its whole `cause`/`errors` chain, when there is one. */
  readonly error?: SerializedError;
}

/**
 * A destination for {@link LogRecord}s. It is an object so that it can grow lifecycle methods
 * without changing what a sink is.
 *
 * `write` receives the record and the {@link Resource} in force when it was emitted; that
 * `(record, resource)` arity is part of the `vipengele.logger.provider.v1` protocol (ADR-0005).
 * Whatever `write` returns is ignored: a returned promise is not awaited, and a rejection is not
 * observed. A synchronous throw is caught per sink and reported through
 * {@link EmitSettings.onSinkError}; it never reaches the caller of the Logger and never stops
 * another sink from receiving the record.
 */
export interface Sink {
  write(record: LogRecord, resource: Resource): void;
}

/**
 * A stage between a record and the sinks: it returns the record to pass on, the one it was handed
 * or another, or `null` to drop it. Processors run in the order they were added, each on what the
 * previous one returned. A global processor (`addProcessor`) sees every record ahead of every
 * sink, and its `null` drops the record for all of them; a per-sink processor (`addSink`'s
 * `processors`) runs after the global ones, ahead of its own sink alone, and its `null` drops the
 * record for that sink only. A processor sees the record after built-in redaction.
 */
export type LogProcessor = (record: LogRecord) => LogRecord | null;

/** A sink as a build carries it: the sink and the processors that run ahead of it alone, in order. */
export interface SinkRegistration {
  readonly sink: Sink;
  readonly processors: readonly LogProcessor[];
}

export type { RedactionSetting };

/**
 * Everything a Logger needs to turn a call into a record and deliver it. A Logger reads these on
 * every call, so what it emits through follows the configuration in force, not the one at its
 * creation.
 *
 * Where each part comes from:
 *
 * - `sinks`, `processors`, `clock` and `redaction` are builder state, carried by `LoggingBuild`
 *   alongside the level layers. A `configure` replaces the sinks; it never appends to those of an earlier one.
 *   A provider made by `createProvider` owns its sinks alone and shares none with the default
 *   provider.
 * - `resource` and `onSinkError` are provider settings, not builder state. They are wired in
 *   from `logging.ts`, because `logger.ts` cannot import `logging.ts` (logging, provider,
 *   logger and logging again would be an import cycle).
 *
 * `createLogger` in `logger.ts` takes them as a third argument, after the category and the level
 * resolver:
 *
 * ```ts
 * createLogger(category: string, resolve: LevelResolver, emit: () => EmitSettings): Logger
 * ```
 *
 * `emit` is read on every call that passes the level check. Building the record (reading the
 * clock, serializing the error, redacting) happens inside one `try`/`catch`: a throwing clock or
 * redaction policy drops that record, delivers it to no sink and does not reach the caller. The
 * global processors run next, then delivery runs per sink: the sink's own processors, then its
 * `write` in its own `try`/`catch` that reports to `onSinkError`.
 */
export interface EmitSettings {
  /**
   * The sinks that receive each record, in order, each with its own processors. Every sink is
   * tried even when one throws.
   */
  readonly sinks: readonly SinkRegistration[];

  /** The processors every record passes through, in order, ahead of every sink's own. */
  readonly processors: readonly LogProcessor[];

  /** The source of {@link LogRecord.time}. */
  readonly clock: Clock;

  /** Redaction applied to a record's attributes and error chain; `null` disables it. */
  readonly redaction: RedactionSetting;

  /**
   * The {@link Resource} handed to every sink. It is a function, `Scope.resource` or a stand-in
   * for it, called once per record: the resource is only known once an application supplies it,
   * which can be after the Logger was created, so a value captured at creation would go stale.
   */
  readonly resource: () => Resource;

  /**
   * Called with the thrown value of a `Sink.write` that failed, once per failing sink per
   * record. It is itself guarded: a throw from `onSinkError` is swallowed, so reporting a sink
   * failure can never break the call that emitted the record.
   */
  readonly onSinkError: (error: unknown) => void;
}
