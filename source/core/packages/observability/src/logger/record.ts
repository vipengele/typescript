import type { Attributes, Clock, Level, SerializedError } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import type { RedactionPolicy } from "@vipengele/ts-core-redaction";

/**
 * One emitted log entry, the shape every {@link Sink} receives (ADR-0007). It carries the
 * attributes of the call that produced it; the ambient Scope's attributes are not part of it.
 */
export interface LogRecord {
  /** Epoch milliseconds with a sub-millisecond fraction, read from the {@link Clock} in force. */
  readonly time: number;
  readonly level: Level;
  /** The Category of the Logger that emitted the record. */
  readonly category: string;
  readonly message: string;
  /** The call's attributes, redacted when a {@link RedactionSetting} policy is in force. */
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
 * How records are redacted: a `RedactionPolicy` from `@vipengele/ts-core-redaction` (the
 * `secretKeys` preset, a `composePolicies` result, or a policy of the caller's own), or `null`
 * for no redaction. The setting holds the policy only; the package never reads the preset itself
 * at module scope, so a consumer that disables redaction pays nothing for it (ADR-0011).
 *
 * A policy is applied to `attributes` and to every link of the serialized error chain (`error`,
 * and each `cause` and `errors` entry beneath it), when the record is created and before any sink
 * sees it: to the `data` and `code` of a link for an `Error`, `code` read under the key `code`,
 * and to the fields of a structured thrown value that is not an `Error`, carried as JSON text in
 * its synthetic link's `message`; a thrown string is read the same way when it opens with `{` or
 * `[` after any leading whitespace and byte order mark. That text is replaced whole when it does
 * not parse, as when it was cut at the serialization length bound.
 * The record's `message`, and the `message` and `stack` of an `Error`, are not scanned: a secret
 * interpolated into a message is the caller's to keep out.
 */
export type RedactionSetting = RedactionPolicy | null;

/**
 * Everything a Logger needs to turn a call into a record and deliver it. A Logger reads these on
 * every call, so what it emits through follows the configuration in force, not the one at its
 * creation.
 *
 * Where each part comes from:
 *
 * - `sinks`, `clock` and `redaction` are builder state, carried by `LoggingBuild` alongside the
 *   level layers. A `configure` replaces the sinks; it never appends to those of an earlier one.
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
 * redaction policy drops that record, delivers it to no sink and does not reach the caller.
 * Delivery then runs per sink, each `write` in its own `try`/`catch` that reports to
 * `onSinkError`.
 */
export interface EmitSettings {
  /** The sinks that receive each record, in order. Every sink is tried even when one throws. */
  readonly sinks: readonly Sink[];

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
