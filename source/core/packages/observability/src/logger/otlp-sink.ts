import type { Clock, Scheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { createDelivery, type DeliveryFetch, type DeliveryLimits, type DropReason } from "../delivery/delivery";
import { deliveryOptionsProblem } from "../delivery/options";
import type { LifecycleTargets } from "../delivery/unload";
import { encodeLogs } from "../otlp/encode-logs";
import { LoggingConfigError } from "./config-error";
import type { LogRecord, Sink } from "./record";

/** Why records left the sink without reaching the collector; see the delivery's drop reasons. */
export type OtlpDropReason = DropReason;

/** Where an OTLP log sink exports to, and how it batches, retries and reports drops. */
export interface OtlpLogSinkOptions {
  /** The collector's OTLP/HTTP logs endpoint, an absolute `http:` or `https:` URL. */
  readonly url: string;
  /** Sent with every export, read once per batch when a thunk; `content-type` is always `application/json`. */
  readonly headers?: Record<string, string> | (() => Record<string, string>);
  /** Defaults to `globalThis.fetch`, looked up at each attempt. */
  readonly fetch?: DeliveryFetch;
  /** Stamps the observed time of each record; defaults to `systemClock`. */
  readonly clock?: Clock;
  /** Supplies the batch delay, the backoff and the timeouts; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
  /** Where `pagehide` and `visibilitychange` arrive; detected on `globalThis` when omitted, none watched for `{}`. */
  readonly lifecycle?: LifecycleTargets;
  /**
   * Batching and retry limits over the OpenTelemetry batch processor defaults. The sizes and
   * `maxAttempts` are integers of at least 1; the delays and timeouts are positive and finite.
   */
  readonly limits?: Partial<DeliveryLimits>;
  /** Told how many records were dropped and why; a throw is swallowed. */
  readonly onDrop?: (reason: OtlpDropReason, count: number) => void;
}

/** A {@link Sink} that exports records as OTLP/HTTP JSON, and can be flushed and closed. */
export type OtlpLogSink = Sink & {
  /** Exports everything buffered; resolves `true` once delivered or dropped, `false` on timeout. Never rejects. */
  flush(timeoutMs?: number): Promise<boolean>;
  /** Flushes, drops what is left on timeout as `"closed"`, and turns every later `write` into a no-op. Never rejects. */
  close(timeoutMs?: number): Promise<boolean>;
};

/**
 * Creates a {@link Sink} that buffers each record and exports batches to an OTLP/HTTP logs endpoint
 * as JSON, retrying transient failures. `write` returns at once and never throws. The sink adds no
 * exit hook: a host awaits `close()` before the process ends.
 *
 * Throws a `LoggingConfigError` when `url` is not an absolute http or https URL or a limit is invalid.
 */
export function createOtlpLogSink(options: OtlpLogSinkOptions): OtlpLogSink {
  const problem = deliveryOptionsProblem(options.url, options.limits);
  if (problem !== undefined) {
    throw new LoggingConfigError(`createOtlpLogSink expects ${problem}`);
  }
  const delivery = createDelivery<LogRecord>({
    url: options.url,
    headers: options.headers,
    fetch: options.fetch,
    clock: options.clock,
    scheduler: options.scheduler,
    lifecycle: options.lifecycle,
    limits: options.limits,
    onDrop: options.onDrop,
    encode: (entries) => encodeLogs(entries.map(({ item, resource, observedMs }) => ({ record: item, resource, observedMs }))),
  });
  return {
    write(record: LogRecord, resource: Resource): void {
      delivery.enqueue(record, resource);
    },
    flush: (timeoutMs) => delivery.flush(timeoutMs),
    close: (timeoutMs) => delivery.close(timeoutMs),
  };
}
