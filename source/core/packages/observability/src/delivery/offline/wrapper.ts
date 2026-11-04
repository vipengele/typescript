import type { Clock, Scheduler } from "@vipengele/ts-core-common";
import type { DeliveryEntry, DeliveryFetch } from "../delivery";
import type { StatusClass } from "../retry-policy";
import { detectLifecycleTargets, type LifecycleTargets } from "../unload";
import { type OfflineDropReason, type OfflineHeaders, OfflineQueue } from "./offline-queue";
import { type OfflineStore, openOfflineStore } from "./store";

const OFFLINE_DATABASE = "vipengele-otlp-offline";
const OFFLINE_MAX_ENTRIES = 30;
const OFFLINE_MAX_BYTES = 1_048_576;

/** How the offline queue is bounded and where it saves. */
export interface OfflineOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly indexedDB?: IDBFactory;
}

/** The offline queue with the store it saves into. */
export interface Offline<T> {
  readonly queue: OfflineQueue<T>;
  readonly store: Promise<OfflineStore | undefined>;
}

/** What a wrapper hands {@link openOffline}: its own options plus how its items are keyed and encoded. */
export interface OfflineWrapperOptions<T> {
  readonly url: string;
  readonly headers?: OfflineHeaders;
  readonly contentType?: string;
  readonly classify?: (status: number) => StatusClass;
  readonly fetch?: DeliveryFetch;
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
  readonly lifecycle?: LifecycleTargets;
  readonly onDrop?: (reason: OfflineDropReason, count: number) => void;
  readonly offline?: true | OfflineOptions;
  /** Distinguishes this wrapper's bodies from the other's under the same URL. */
  readonly keySuffix: string;
  /** Omitted for a wrapper that saves only already-encoded bodies, through `saveBody`. */
  readonly encode?: (entries: ReadonlyArray<DeliveryEntry<T>>) => string;
}

function isPositiveInteger(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 1);
}

/** Why `offline` cannot configure the queue, completing "createX expects ", or `undefined`. */
export function offlineProblem(offline: true | OfflineOptions | undefined): string | undefined {
  if (offline === undefined || offline === true) {
    return undefined;
  }
  if (!isPositiveInteger(offline.maxEntries)) {
    return `offline.maxEntries to be an integer of at least 1, got ${offline.maxEntries}`;
  }
  return isPositiveInteger(offline.maxBytes) ? undefined : `offline.maxBytes to be an integer of at least 1, got ${offline.maxBytes}`;
}

/** Opens the store and builds the queue over it, or `undefined` when `offline` is off. */
export function openOffline<T>(options: OfflineWrapperOptions<T>): Offline<T> | undefined {
  if (options.offline === undefined) {
    return undefined;
  }
  const given = options.offline === true ? {} : options.offline;
  const limits = { maxEntries: given.maxEntries ?? OFFLINE_MAX_ENTRIES, maxBytes: given.maxBytes ?? OFFLINE_MAX_BYTES };
  const store = openOfflineStore(given.indexedDB ?? globalThis.indexedDB, OFFLINE_DATABASE, limits);
  const queue = new OfflineQueue<T>({
    key: `${options.url}|${options.keySuffix}`,
    encode: options.encode,
    url: options.url,
    headers: options.headers,
    contentType: options.contentType,
    classify: options.classify,
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

function closeStore(store: OfflineStore | undefined): void {
  store?.close();
}

/** Closes the store once every pending save has its outcome, without waiting for that here. */
function closeWhenIdle<T>(offline: Offline<T>): void {
  void offline.queue
    .idle()
    .then(() => offline.store)
    .then(closeStore);
}

/** Waits for the saves within what is left of `budget` since `started`, or for as long as they take with no budget. */
function settleSaves<T>(offline: Offline<T>, budget: number | undefined, started: number, clock: Clock): Promise<boolean> {
  if (budget === undefined) {
    return offline.queue.idle().then(() => true);
  }
  return offline.queue.settle(budget - (clock() - started));
}

/**
 * Runs the delivery's `flush` or `close`, then waits for the offline saves with what is left of the
 * timeout, or, with neither a timeout nor a default, until they finish. A closing drain also stops the queue and closes the store: before resolving when the saves
 * finish within the timeout, and otherwise once they finish, after resolving `false`. Closing the
 * store while a save still waits for it would fail that save and report its entries as dropped.
 */
export async function drain<T>(
  run: (timeoutMs: number | undefined) => Promise<boolean>,
  offline: Offline<T> | undefined,
  closing: boolean,
  clock: Clock,
  timeoutMs: number | undefined,
  defaultTimeout: number | undefined,
): Promise<boolean> {
  if (offline === undefined) {
    return run(timeoutMs);
  }
  const budget = timeoutMs ?? defaultTimeout;
  const started = clock();
  const delivered = await run(budget);
  const settled = await settleSaves(offline, budget, started, clock);
  if (closing) {
    offline.queue.close();
    if (settled) {
      closeStore(await offline.store);
    } else {
      closeWhenIdle(offline);
    }
  }
  return delivered && settled;
}
