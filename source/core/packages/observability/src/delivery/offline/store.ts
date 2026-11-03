import { utf8ByteLength } from "../unload";

/** The schema version; the object store and its index are created when the database is first opened. */
const VERSION = 1;
const BODIES = "bodies";
const BY_KEY = "key";

/** How much the store holds at most, across every key. */
export interface OfflineLimits {
  /** How many bodies the store holds; one body counts once, whatever its entry `count`. */
  readonly maxEntries: number;
  /** How many UTF-8 bytes of body the store holds. */
  readonly maxBytes: number;
}

/** An encoded request body saved for replay, with the entry count it carries. */
export interface StoredBody {
  /** Assigned by the store in insertion order, so a lower `id` is an older body. */
  readonly id: number;
  /** Which queue the body belongs to; a queue reads back only its own key. */
  readonly key: string;
  readonly body: string;
  /** How many entries the body encodes. */
  readonly count: number;
  /** The UTF-8 length of `body`. */
  readonly bytes: number;
  /** The epoch milliseconds at which the body was saved. */
  readonly storedAt: number;
}

/** A body to save; the store assigns `id` and measures `bytes`. */
export type NewStoredBody = Omit<StoredBody, "id" | "bytes">;

/**
 * How a `put` ended: `"stored"`, `"full"` when saving it would take the store past either bound
 * (nothing is stored, the older bodies are kept), or `"failed"` when the write did not happen.
 */
export type PutOutcome = "stored" | "full" | "failed";

/**
 * Encoded request bodies kept in IndexedDB. No method rejects: once the connection is closed, by
 * `close` or by a `versionchange` from another connection, `put` resolves `"failed"`, `oldest`
 * resolves `undefined` and `delete` resolves without deleting.
 */
export interface OfflineStore {
  put(record: NewStoredBody): Promise<PutOutcome>;
  /** The oldest body saved under `key`, or `undefined` when there is none or it cannot be read. */
  oldest(key: string): Promise<StoredBody | undefined>;
  delete(id: number): Promise<void>;
  close(): void;
}

/** What the store holds: how many bodies, and their UTF-8 bytes together. */
export interface StoreUsage {
  readonly entries: number;
  readonly bytes: number;
}

/** The usage of `records` together. */
export function usageOf(records: ReadonlyArray<Pick<StoredBody, "bytes">>): StoreUsage {
  let bytes = 0;
  for (const record of records) {
    bytes += record.bytes;
  }
  return { entries: records.length, bytes };
}

/** Whether one more body of `bytes` fits beside `usage` without passing either bound of `limits`. */
export function fitsLimits(usage: StoreUsage, bytes: number, limits: OfflineLimits): boolean {
  return usage.entries + 1 <= limits.maxEntries && usage.bytes + bytes <= limits.maxBytes;
}

function createSchema(database: IDBDatabase): void {
  const bodies = database.createObjectStore(BODIES, { keyPath: "id", autoIncrement: true });
  bodies.createIndex(BY_KEY, BY_KEY);
}

/** A body as written: everything but the `id` the store assigns. */
type StoredBodyDraft = Omit<StoredBody, "id">;

/** A connection to the database; every method starts its own transaction and never rejects. */
class IndexedDbOfflineStore implements OfflineStore {
  readonly #database: IDBDatabase;
  readonly #limits: OfflineLimits;
  #closed = false;

  constructor(database: IDBDatabase, limits: OfflineLimits) {
    this.#database = database;
    this.#limits = limits;
    database.onversionchange = () => this.close();
  }

  put(record: NewStoredBody): Promise<PutOutcome> {
    const transaction = this.#transaction("readwrite");
    if (transaction === undefined) {
      return Promise.resolve("failed");
    }
    return new Promise((resolve) => {
      const bodies = transaction.objectStore(BODIES);
      const stored: StoredBodyDraft = { ...record, bytes: utf8ByteLength(record.body) };
      const all = bodies.getAll();
      let outcome: PutOutcome = "full";
      all.onsuccess = () => {
        if (fitsLimits(usageOf(all.result as StoredBody[]), stored.bytes, this.#limits)) {
          bodies.add(stored);
          outcome = "stored";
        }
      };
      transaction.oncomplete = () => resolve(outcome);
      transaction.onabort = () => resolve("failed");
    });
  }

  oldest(key: string): Promise<StoredBody | undefined> {
    const transaction = this.#transaction("readonly");
    if (transaction === undefined) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      const request = transaction.objectStore(BODIES).index(BY_KEY).get(key);
      request.onsuccess = () => resolve(request.result as StoredBody | undefined);
      transaction.onabort = () => resolve(undefined);
    });
  }

  delete(id: number): Promise<void> {
    const transaction = this.#transaction("readwrite");
    if (transaction === undefined) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      transaction.objectStore(BODIES).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  close(): void {
    this.#closed = true;
    this.#database.close();
  }

  /** A transaction over the bodies, or `undefined` once the connection is closed or refuses one. */
  #transaction(mode: IDBTransactionMode): IDBTransaction | undefined {
    if (this.#closed) {
      return undefined;
    }
    try {
      return this.#database.transaction(BODIES, mode);
    } catch {
      return undefined;
    }
  }
}

/**
 * Settles an open request: the store once it succeeds, `undefined` once it errors or is blocked
 * by another connection. A connection that opens after the request was already settled as
 * blocked is closed at once.
 */
function settleOpen(request: IDBOpenDBRequest, limits: OfflineLimits, resolve: (store: OfflineStore | undefined) => void): void {
  let settled = false;
  const fail = (): void => {
    settled = true;
    resolve(undefined);
  };
  request.onupgradeneeded = () => createSchema(request.result);
  request.onsuccess = () => {
    if (settled) {
      request.result.close();
      return;
    }
    resolve(new IndexedDbOfflineStore(request.result, limits));
  };
  request.onerror = fail;
  request.onblocked = fail;
}

/**
 * Opens the database `name` from `factory` as an {@link OfflineStore} bounded by `limits`.
 * Resolves `undefined`, and never rejects, when there is no factory or the open throws, errors or
 * is blocked.
 */
export function openOfflineStore(factory: IDBFactory | undefined, name: string, limits: OfflineLimits): Promise<OfflineStore | undefined> {
  if (factory === undefined) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, VERSION);
    } catch {
      resolve(undefined);
      return;
    }
    settleOpen(request, limits, resolve);
  });
}
