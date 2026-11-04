import { type Clock, type Scheduler, systemClock, systemScheduler } from "@vipengele/ts-core-common";
import type { DeliveryEntry, DeliveryFetch, DeliveryRequest, DeliveryResponse, DropReason, UndeliveredReason } from "../delivery";
import { classifyStatus, type StatusClass } from "../retry-policy";
import { type LifecycleTarget, utf8ByteLength } from "../unload";
import { fitsLimits, type NewStoredBody, type OfflineLimits, type OfflineStore, type PutOutcome, type StoreUsage } from "./store";

/**
 * Why entries left an offline-backed delivery without reaching the collector: a delivery
 * {@link DropReason}, or `"offline-full"` when the offline store, or the memory holding writes until
 * the store opens, refused the body as over its bounds.
 */
export type OfflineDropReason = DropReason | "offline-full";

/** Replay headers: a fixed record, or a thunk returning one or a promise of one. */
export type OfflineHeaders = Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

/** Told why a saved body could not be kept; a throw is swallowed. */
export type SaveDropListener = (reason: OfflineDropReason) => void;

/** The part of a `Navigator` the queue reads. */
export interface OfflineNavigator {
  readonly onLine?: unknown;
}

export interface OfflineQueueOptions<T> {
  /** The key the queue's bodies are saved under; a queue replays only its own key. */
  readonly key: string;
  /**
   * Turns undelivered entries into the request body that is saved and replayed. Omitted, `undelivered`
   * reports its entries as `"rejected"`, and bodies reach the queue only through `saveBody`.
   */
  readonly encode?: (entries: ReadonlyArray<DeliveryEntry<T>>) => string;
  /** Where a saved body is POSTed on replay. */
  readonly url: string;
  /** Sent with every replay, read and awaited once per request when a thunk; `content-type` is always `contentType`. */
  readonly headers?: OfflineHeaders;
  /** The `content-type` every replay is sent with; defaults to `application/json`. */
  readonly contentType?: string;
  /** Reads a replay's status; defaults to the OTLP/HTTP classification. A `"retryable"` status keeps the body. */
  readonly classify?: (status: number) => StatusClass;
  /** Defaults to `globalThis.fetch`, looked up at each replay request. */
  readonly fetch?: DeliveryFetch;
  /** The store the bodies are saved in; `undefined` when none could be opened. Never expected to reject. */
  readonly store: Promise<OfflineStore | undefined>;
  /** The bounds the memory holding writes until the store opens counts against. */
  readonly limits: OfflineLimits;
  /** Told how many entries were dropped and why; a throw is swallowed. */
  readonly onDrop: (reason: OfflineDropReason, count: number) => void;
  /** Stamps `storedAt`; defaults to `systemClock`. */
  readonly clock?: Clock;
  /** Supplies the `settle` timeout; defaults to `systemScheduler`. */
  readonly scheduler?: Scheduler;
  /** Where `online` arrives; omitted, replay runs only once the store opens. */
  readonly window?: LifecycleTarget | undefined;
  /** Read by `isOffline`; omitted, the queue is never offline. */
  readonly navigator?: OfflineNavigator | undefined;
}

/** How one replay request ended: delete the body, delete it and report it rejected, or stop and keep it. */
type ReplayVerdict = "delivered" | "rejected" | "stop";

const NOTHING_HELD: StoreUsage = Object.freeze({ entries: 0, bytes: 0 });

function noop(): void {}

function nothing(): undefined {
  return undefined;
}

function failed(): PutOutcome {
  return "failed";
}

function cannotEncode(): string {
  throw new TypeError("The offline queue has no encoder");
}

/** Tells `listener` of a drop, swallowing its throw: the listener is the host's observer. */
function notify(listener: SaveDropListener, reason: OfflineDropReason): void {
  try {
    listener(reason);
  } catch {
    // The listener's failure is not the queue's to report.
  }
}

function defaultFetch(url: string, init: DeliveryRequest): Promise<DeliveryResponse> {
  return globalThis.fetch(url, init);
}

/** The headers of one replay request: the configured ones, the thunk run and awaited once, and `content-type` last. */
async function requestHeaders(headers: OfflineHeaders | undefined, contentType: string): Promise<Record<string, string>> {
  const configured = typeof headers === "function" ? await headers() : headers;
  return { ...configured, "content-type": contentType };
}

/**
 * Saves the batches a delivery gives up on as encoded request bodies, and replays them.
 *
 * `undelivered`, given to the delivery, encodes the entries and saves the body under `key`. A body
 * the store refuses as full is reported as `"offline-full"`; a write that fails, or a store that
 * never opened, reports the entries with the reason the delivery gave. Until the store opens,
 * bodies wait in memory under `limits`, and one past them is reported as `"offline-full"`. Every
 * report arrives after the write's outcome, never synchronously.
 *
 * Replay starts once the store opens and on each `online` event at `window`, and sends the saved
 * bodies oldest first, one request at a time; a replay already running is not started again. A
 * 2xx deletes the body, a status that is not retried deletes it and reports it `"rejected"`, and a
 * network error or a retryable status stops the replay and keeps it. A replay delivers at least
 * once: a body sent but not yet deleted is sent again by the next replay.
 */
export class OfflineQueue<T> {
  readonly #options: OfflineQueueOptions<T>;
  readonly #fetch: DeliveryFetch;
  readonly #encode: (entries: ReadonlyArray<DeliveryEntry<T>>) => string;
  readonly #classify: (status: number) => StatusClass;
  readonly #contentType: string;
  readonly #clock: Clock;
  readonly #scheduler: Scheduler;
  /** The store once the open settles, with a rejected open read as no store. */
  readonly #ready: Promise<OfflineStore | undefined>;
  /** Aborts the replay request in flight on `close`. */
  readonly #abort = new AbortController();
  /** Writes whose outcome is not yet reported. */
  readonly #writes = new Set<Promise<void>>();

  #opened = false;
  #store: OfflineStore | undefined;
  /** What waits in memory for the store to open. */
  #held: StoreUsage = NOTHING_HELD;
  #replaying = false;
  #closed = false;

  constructor(options: OfflineQueueOptions<T>) {
    this.#options = options;
    this.#fetch = options.fetch ?? defaultFetch;
    this.#encode = options.encode ?? cannotEncode;
    this.#classify = options.classify ?? classifyStatus;
    this.#contentType = options.contentType ?? "application/json";
    this.#clock = options.clock ?? systemClock;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#ready = Promise.resolve(options.store).catch(nothing);
    void this.#ready.then(this.#onOpen);
    options.window?.addEventListener("online", this.#onOnline);
  }

  /** The delivery's `undelivered` hook: saves `entries` as one body, reporting them if it cannot. */
  readonly undelivered = (entries: ReadonlyArray<DeliveryEntry<T>>, reason: UndeliveredReason): void => {
    const count = entries.length;
    let body: string;
    try {
      body = this.#encode(entries);
    } catch {
      this.#report("rejected", count);
      return;
    }
    this.#save(body, count, reason, (dropped) => this.#report(dropped, count));
  };

  /**
   * Saves `body`, already encoded and carrying `count` entries, as `undelivered` saves an encoded
   * batch, but tells `dropped` rather than `onDrop` when it cannot be kept: `"offline-full"` for a
   * body over the bounds, `reason` for a failed write or no store. A replay rejecting the body is
   * still reported to `onDrop`.
   */
  saveBody(body: string, count: number, reason: UndeliveredReason, dropped: SaveDropListener): void {
    this.#save(body, count, reason, (refused) => notify(dropped, refused));
  }

  /** The delivery's `isOffline` hook: whether the navigator reports no network. */
  readonly isOffline = (): boolean => this.#options.navigator?.onLine === false;

  /**
   * Resolves `true` once every write issued so far has its outcome, `false` if `timeoutMs` elapses
   * first. Never waits for a replay, and never rejects.
   */
  async settle(timeoutMs: number): Promise<boolean> {
    if (this.#writes.size === 0) {
      return true;
    }
    const written = Promise.all(this.#writes).then(() => true);
    const deadline = new AbortController();
    const elapsed = this.#scheduler.sleep(Math.max(0, timeoutMs), deadline.signal).then(
      () => false,
      () => false,
    );
    try {
      return await Promise.race([written, elapsed]);
    } finally {
      deadline.abort();
    }
  }

  /**
   * Resolves once every write issued so far, and every write issued while it waits, has its
   * outcome. Has no timeout, never waits for a replay, and never rejects.
   */
  async idle(): Promise<void> {
    while (this.#writes.size > 0) {
      await Promise.all(this.#writes);
    }
  }

  /**
   * Stops listening for `online`, aborts the replay request in flight and starts no further
   * replay. Writes still go to the store, which the queue does not close: its owner closes it once
   * `idle` resolves.
   */
  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#abort.abort();
    this.#options.window?.removeEventListener("online", this.#onOnline);
  }

  readonly #onOpen = (store: OfflineStore | undefined): void => {
    this.#opened = true;
    this.#store = store;
    this.#held = NOTHING_HELD;
    this.#replay();
  };

  readonly #onOnline = (): void => {
    this.#replay();
  };

  #report(reason: OfflineDropReason, count: number): void {
    const onDrop = this.#options.onDrop;
    notify((dropped) => onDrop(dropped, count), reason);
  }

  #save(body: string, count: number, reason: UndeliveredReason, report: (reason: OfflineDropReason) => void): void {
    if (!this.#opened && !this.#hold(body)) {
      // Reported from a tracked microtask, so `settle` and `idle` wait for it and the caller's own
      // code after `undelivered` or `saveBody` runs first.
      this.#track(Promise.resolve().then(() => report("offline-full")));
      return;
    }
    const record: NewStoredBody = { key: this.#options.key, body, count, storedAt: this.#clock() };
    this.#track(this.#ready.then((store) => this.#write(store, record, reason, report)));
  }

  /** Counts `body` against `limits` while the store is not open; `false` when it does not fit. */
  #hold(body: string): boolean {
    const bytes = utf8ByteLength(body);
    if (!fitsLimits(this.#held, bytes, this.#options.limits)) {
      return false;
    }
    this.#held = { entries: this.#held.entries + 1, bytes: this.#held.bytes + bytes };
    return true;
  }

  #track(write: Promise<void>): void {
    this.#writes.add(write);
    void write.then(() => this.#writes.delete(write));
  }

  async #write(
    store: OfflineStore | undefined,
    record: NewStoredBody,
    reason: UndeliveredReason,
    report: (reason: OfflineDropReason) => void,
  ): Promise<void> {
    if (store === undefined) {
      report(reason);
      return;
    }
    const outcome = await store.put(record).catch(failed);
    if (outcome === "full") {
      report("offline-full");
    } else if (outcome === "failed") {
      report(reason);
    }
  }

  /** Starts a replay unless one is running, the queue is closed, or there is no store. */
  #replay(): void {
    const store = this.#store;
    if (this.#replaying || this.#closed || store === undefined) {
      return;
    }
    this.#replaying = true;
    void this.#replayAll(store).then(this.#replayEnded, this.#replayEnded);
  }

  readonly #replayEnded = (): void => {
    this.#replaying = false;
  };

  /**
   * Sends the key's bodies oldest first until none is left, one is kept, or the queue closes. A
   * body read back after it was sent ends the replay too: its delete did not happen, and sending it
   * again would loop.
   */
  async #replayAll(store: OfflineStore): Promise<void> {
    let previous: number | undefined;
    while (!this.#closed) {
      const record = await store.oldest(this.#options.key);
      if (record === undefined || record.id === previous) {
        return;
      }
      previous = record.id;
      const verdict = await this.#send(record.body);
      if (verdict === "stop") {
        return;
      }
      await store.delete(record.id);
      if (verdict === "rejected") {
        this.#report("rejected", record.count);
      }
    }
  }

  /** One replay request. A throw from the `headers` thunk or from `fetch`, or a rejection, keeps the body. */
  async #send(body: string): Promise<ReplayVerdict> {
    const doFetch = this.#fetch;
    let response: DeliveryResponse;
    try {
      const headers = await requestHeaders(this.#options.headers, this.#contentType);
      response = await doFetch(this.#options.url, { method: "POST", headers, body, signal: this.#abort.signal });
    } catch {
      return "stop";
    }
    response.body?.cancel().catch(noop);
    const verdict = this.#classify(response.status);
    return verdict === "retryable" ? "stop" : verdict;
  }
}
