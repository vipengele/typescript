import { type Clock, type Scheduler, systemClock } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import {
  createDelivery,
  DEFAULT_DELIVERY_LIMITS,
  type DeliveryEntry,
  type DeliveryFetch,
  type DeliveryLimits,
} from "../../delivery/delivery";
import { type OfflineDropReason, OfflineQueue } from "../../delivery/offline/offline-queue";
import { type OfflineStore, openOfflineStore } from "../../delivery/offline/store";
import { deliveryOptionsProblem } from "../../delivery/options";
import { detectLifecycleTargets, type LifecycleTargets } from "../../delivery/unload";
import { encodeErrorEvents } from "../../otlp/encode-error-events";
import type { ErrorEvent } from "../event";
import { ReporterConfigError } from "../reporter-config-error";
import type { Transport } from "../transport";

const OFFLINE_DATABASE = "vipengele-otlp-offline";
const OFFLINE_MAX_ENTRIES = 30;
const OFFLINE_MAX_BYTES = 1_048_576;

/**
 * Why events left the transport without reaching the collector; see the delivery's drop reasons.
 * `"offline-full"` is a batch the offline queue refused because it was over its bounds.
 */
export type OtlpTransportDropReason = OfflineDropReason;

/** How the offline queue is bounded and where it saves; see {@link OtlpTransportOptions.offline}. */
export interface OtlpTransportOfflineOptions {
  /** How many batches the queue holds, across every sink and transport sharing the database. Defaults to 30. */
  readonly maxEntries?: number;
  /** How many UTF-8 bytes of request body the queue holds. Defaults to 1 MiB. */
  readonly maxBytes?: number;
  /** Defaults to `globalThis.indexedDB`. */
  readonly indexedDB?: IDBFactory;
}

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
  /**
   * Saves the batches the transport gives up on (`retries-exhausted`, `unload-budget`, `closed`) in
   * IndexedDB and replays them on creation and when the window reports `online`. Delivery is at
   * least once. A batch is kept oldest-first and a full queue refuses the new batch as
   * `"offline-full"`. Drops are reported after the save's outcome, never synchronously. Without
   * IndexedDB, or when it cannot be opened, nothing is saved and the drop is reported as without
   * this option. `lifecycle: {}` also stops the `online` replay.
   */
  readonly offline?: true | OtlpTransportOfflineOptions;
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
 * With `offline`, `flush` and `close` also wait for pending saves and resolve `false` if they
 * outlast the timeout.
 */
export function createOtlpTransport(options: OtlpTransportOptions): OtlpTransport {
  const problem = deliveryOptionsProblem(options.url, options.limits) ?? offlineProblem(options.offline);
  if (problem !== undefined) {
    throw new ReporterConfigError(`createOtlpTransport expects ${problem}`);
  }
  const offline = openOffline(options);
  const delivery = createDelivery<ErrorEvent>({
    url: options.url,
    headers: options.headers,
    fetch: options.fetch,
    clock: options.clock,
    scheduler: options.scheduler,
    lifecycle: options.lifecycle,
    limits: options.limits,
    onDrop: options.onDrop,
    undelivered: offline?.queue.undelivered,
    isOffline: offline?.queue.isOffline,
    encode: encodeEntries,
  });
  const clock = options.clock ?? systemClock;
  const defaultTimeout = options.limits?.flushTimeoutMs ?? DEFAULT_DELIVERY_LIMITS.flushTimeoutMs;
  return {
    send(event: ErrorEvent, resource: Resource): void {
      delivery.enqueue(event, resource);
    },
    flush: (timeoutMs) => drain((t) => delivery.flush(t), offline, false, clock, timeoutMs, defaultTimeout),
    close: (timeoutMs) => drain((t) => delivery.close(t), offline, true, clock, timeoutMs, defaultTimeout),
  };
}

/** The offline queue with the store it saves into. */
interface Offline {
  readonly queue: OfflineQueue<ErrorEvent>;
  readonly store: Promise<OfflineStore | undefined>;
}

function encodeEntries(entries: ReadonlyArray<DeliveryEntry<ErrorEvent>>): string {
  return encodeErrorEvents(entries.map(({ item, resource, observedMs }) => ({ event: item, resource, observedMs })));
}

function isPositiveInteger(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 1);
}

/** Why `offline` cannot configure the queue, or `undefined`; completes "createOtlpTransport expects ". */
function offlineProblem(offline: OtlpTransportOptions["offline"]): string | undefined {
  if (offline === undefined || offline === true) {
    return undefined;
  }
  if (!isPositiveInteger(offline.maxEntries)) {
    return `offline.maxEntries to be an integer of at least 1, got ${offline.maxEntries}`;
  }
  return isPositiveInteger(offline.maxBytes) ? undefined : `offline.maxBytes to be an integer of at least 1, got ${offline.maxBytes}`;
}

/** Opens the store and builds the queue over it, or `undefined` when `offline` is off. */
function openOffline(options: OtlpTransportOptions): Offline | undefined {
  if (options.offline === undefined) {
    return undefined;
  }
  const given = options.offline === true ? {} : options.offline;
  const limits = { maxEntries: given.maxEntries ?? OFFLINE_MAX_ENTRIES, maxBytes: given.maxBytes ?? OFFLINE_MAX_BYTES };
  const store = openOfflineStore(given.indexedDB ?? globalThis.indexedDB, OFFLINE_DATABASE, limits);
  const queue = new OfflineQueue<ErrorEvent>({
    key: `${options.url}|errors`,
    encode: encodeEntries,
    url: options.url,
    headers: options.headers,
    fetch: options.fetch,
    store,
    limits,
    onDrop: options.onDrop ?? noop,
    clock: options.clock,
    scheduler: options.scheduler,
    window: (options.lifecycle ?? detectLifecycleTargets()).window,
    navigator: globalThis.navigator,
  });
  return { queue, store };
}

function noop(): void {}

/**
 * Runs the delivery's `flush` or `close`, then waits for the offline saves with what is left of the
 * timeout. A closing drain also stops the queue and, once its saves are done, closes the store.
 */
async function drain(
  run: (timeoutMs: number | undefined) => Promise<boolean>,
  offline: Offline | undefined,
  closing: boolean,
  clock: Clock,
  timeoutMs: number | undefined,
  defaultTimeout: number,
): Promise<boolean> {
  if (offline === undefined) {
    return run(timeoutMs);
  }
  const budget = timeoutMs ?? defaultTimeout;
  const started = clock();
  const delivered = await run(budget);
  const settled = await offline.queue.settle(budget - (clock() - started));
  if (closing) {
    offline.queue.close();
    if (settled) {
      (await offline.store)?.close();
    }
  }
  return delivered && settled;
}
