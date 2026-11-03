import type { Clock, Scheduler } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { createDelivery, type DeliveryFetch, type DeliveryLimits, type DropReason } from "../../delivery/delivery";
import { deliveryOptionsProblem } from "../../delivery/options";
import type { LifecycleTargets } from "../../delivery/unload";
import { encodeErrorEvents } from "../../otlp/encode-error-events";
import type { ErrorEvent } from "../event";
import { ReporterConfigError } from "../reporter-config-error";
import type { Transport } from "../transport";

/** Why events left the transport without reaching the collector; see the delivery's drop reasons. */
export type OtlpTransportDropReason = DropReason;

/** Where an OTLP transport exports to, and how it batches, retries and reports drops. */
export interface OtlpTransportOptions {
  /** The collector's OTLP/HTTP logs endpoint, an absolute `http:` or `https:` URL. */
  readonly url: string;
  /** Sent with every export, read once per batch when a thunk; `content-type` is always `application/json`. */
  readonly headers?: Record<string, string> | (() => Record<string, string>);
  /** Defaults to `globalThis.fetch`, looked up at each attempt. */
  readonly fetch?: DeliveryFetch;
  /** Stamps the observed time of each event; defaults to `systemClock`. */
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
  /** Told how many events were dropped and why; a throw is swallowed. */
  readonly onDrop?: (reason: OtlpTransportDropReason, count: number) => void;
}

/** A {@link Transport} that exports Error Events as OTLP/HTTP JSON log records. */
export interface OtlpTransport extends Transport {
  /** Exports everything buffered; resolves `true` once delivered or dropped, `false` on timeout. Never rejects. */
  flush(timeoutMs?: number): Promise<boolean>;
  /** Flushes, drops what is left on timeout as `"closed"`, and turns every later `send` into a no-op. Never rejects. */
  close(timeoutMs?: number): Promise<boolean>;
}

/**
 * Creates an {@link OtlpTransport} that buffers each Error Event and exports batches to an
 * OTLP/HTTP logs endpoint as JSON, one log record per event, retrying transient failures. `send`
 * returns at once and never throws. The transport adds no exit hook of its own: the reporter's
 * `flush`/`close`, or `globalHandlers` under an `"exit"` policy, drains it.
 *
 * Throws a `ReporterConfigError` when `url` is not an absolute http or https URL or a limit is invalid.
 */
export function createOtlpTransport(options: OtlpTransportOptions): OtlpTransport {
  const problem = deliveryOptionsProblem(options.url, options.limits);
  if (problem !== undefined) {
    throw new ReporterConfigError(`createOtlpTransport expects ${problem}`);
  }
  const delivery = createDelivery<ErrorEvent>({
    url: options.url,
    headers: options.headers,
    fetch: options.fetch,
    clock: options.clock,
    scheduler: options.scheduler,
    lifecycle: options.lifecycle,
    limits: options.limits,
    onDrop: options.onDrop,
    encode: (entries) => encodeErrorEvents(entries.map(({ item, resource, observedMs }) => ({ event: item, resource, observedMs }))),
  });
  return {
    send(event: ErrorEvent, resource: Resource): void {
      delivery.enqueue(event, resource);
    },
    flush: (timeoutMs) => delivery.flush(timeoutMs),
    close: (timeoutMs) => delivery.close(timeoutMs),
  };
}
