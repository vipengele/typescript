import { describe, expect, test } from "vitest";
import { fitsLimits, type OfflineStore, openOfflineStore, usageOf } from "./store";

// A scripted `IDBFactory`: every request and transaction is recorded, and the test fires its
// events by hand. The happy paths against a real database are in `store.browser.test.ts`.

type Handler = (() => void) | null;

class FakeRequest {
  result: unknown;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onblocked: Handler = null;
  onupgradeneeded: Handler = null;
}

class FakeTransaction {
  readonly requests: { method: string; args: unknown[]; request: FakeRequest }[] = [];
  oncomplete: Handler = null;
  onabort: Handler = null;

  constructor(readonly mode: IDBTransactionMode) {}

  objectStore() {
    const call =
      (method: string) =>
      (...args: unknown[]) => {
        const request = new FakeRequest();
        this.requests.push({ method, args, request });
        return request;
      };
    return { getAll: call("getAll"), add: call("add"), delete: call("delete"), index: () => ({ get: call("get") }) };
  }
}

class FakeDatabase {
  readonly transactions: FakeTransaction[] = [];
  closed = 0;
  refuse = false;
  onversionchange: Handler = null;

  transaction(_names: string, mode: IDBTransactionMode) {
    if (this.refuse) {
      throw new DOMException("refused", "InvalidStateError");
    }
    const transaction = new FakeTransaction(mode);
    this.transactions.push(transaction);
    return transaction;
  }

  close() {
    this.closed += 1;
  }

  last(): FakeTransaction {
    const transaction = this.transactions.at(-1);
    if (transaction === undefined) {
      throw new Error("no transaction");
    }
    return transaction;
  }
}

function fakeFactory() {
  const opens: { name: string; version: number | undefined; request: FakeRequest }[] = [];
  const factory = {
    open(name: string, version?: number) {
      const request = new FakeRequest();
      opens.push({ name, version, request });
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, opens };
}

const LIMITS = { maxEntries: 3, maxBytes: 100 };
const RECORD = { key: "https://collector.example/v1/logs|logs", body: "[1,2]", count: 2, storedAt: 1000 };

/** Opens a store over a fake database whose open succeeds. */
async function openFake() {
  const { factory, opens } = fakeFactory();
  const opening = openOfflineStore(factory, "offline", LIMITS);
  const database = new FakeDatabase();
  const request = opens[0]?.request as FakeRequest;
  request.result = database;
  request.onsuccess?.();
  const store = (await opening) as OfflineStore;
  return { store, database };
}

describe("usageOf", () => {
  test("counts the bodies and sums their bytes", () => {
    expect(usageOf([{ bytes: 10 }, { bytes: 5 }])).toEqual({ entries: 2, bytes: 15 });
  });

  test("is empty for no bodies", () => {
    expect(usageOf([])).toEqual({ entries: 0, bytes: 0 });
  });
});

describe("fitsLimits", () => {
  const limits = { maxEntries: 2, maxBytes: 10 };

  test("fits a body that takes the store exactly to both bounds", () => {
    expect(fitsLimits({ entries: 1, bytes: 4 }, 6, limits)).toBe(true);
  });

  test("refuses a body past the entry bound", () => {
    expect(fitsLimits({ entries: 2, bytes: 0 }, 1, limits)).toBe(false);
  });

  test("refuses a body past the byte bound", () => {
    expect(fitsLimits({ entries: 0, bytes: 5 }, 6, limits)).toBe(false);
  });

  test("refuses a lone body larger than the byte bound", () => {
    expect(fitsLimits({ entries: 0, bytes: 0 }, 11, limits)).toBe(false);
  });
});

describe("openOfflineStore", () => {
  test("resolves undefined without a factory", async () => {
    await expect(openOfflineStore(undefined, "offline", LIMITS)).resolves.toBeUndefined();
  });

  test("resolves undefined when the open throws", async () => {
    const factory = {
      open() {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as IDBFactory;
    await expect(openOfflineStore(factory, "offline", LIMITS)).resolves.toBeUndefined();
  });

  test("opens the named database at version 1", async () => {
    const { factory, opens } = fakeFactory();
    void openOfflineStore(factory, "vipengele-otlp-offline", LIMITS);
    expect(opens.map(({ name, version }) => [name, version])).toEqual([["vipengele-otlp-offline", 1]]);
  });

  test("resolves undefined when the open errors", async () => {
    const { factory, opens } = fakeFactory();
    const opening = openOfflineStore(factory, "offline", LIMITS);
    opens[0]?.request.onerror?.();
    await expect(opening).resolves.toBeUndefined();
  });

  test("resolves undefined when the open is blocked, and closes a connection that opens later", async () => {
    const { factory, opens } = fakeFactory();
    const opening = openOfflineStore(factory, "offline", LIMITS);
    const request = opens[0]?.request as FakeRequest;
    request.onblocked?.();
    await expect(opening).resolves.toBeUndefined();
    const database = new FakeDatabase();
    request.result = database;
    request.onsuccess?.();
    expect(database.closed).toBe(1);
  });

  test("creates the bodies store, keyed by an increasing id and indexed by key, on upgrade", () => {
    const { factory, opens } = fakeFactory();
    void openOfflineStore(factory, "offline", LIMITS);
    const created: unknown[] = [];
    const request = opens[0]?.request as FakeRequest;
    request.result = {
      createObjectStore(name: string, options: unknown) {
        created.push(["store", name, options]);
        return {
          createIndex(index: string, keyPath: string) {
            created.push(["index", index, keyPath]);
          },
        };
      },
    };
    request.onupgradeneeded?.();
    expect(created).toEqual([
      ["store", "bodies", { keyPath: "id", autoIncrement: true }],
      ["index", "key", "key"],
    ]);
  });
});

describe("put", () => {
  test("adds the body with its UTF-8 length and resolves stored once the transaction completes", async () => {
    const { store, database } = await openFake();
    const putting = store.put({ ...RECORD, body: "é" });
    const transaction = database.last();
    expect(transaction.mode).toBe("readwrite");
    const getAll = transaction.requests[0]?.request as FakeRequest;
    getAll.result = [{ bytes: 10 }];
    getAll.onsuccess?.();
    expect(transaction.requests[1]).toMatchObject({ method: "add", args: [{ ...RECORD, body: "é", bytes: 2 }] });
    transaction.oncomplete?.();
    await expect(putting).resolves.toBe("stored");
  });

  test("adds nothing and resolves full when the body does not fit", async () => {
    const { store, database } = await openFake();
    const putting = store.put(RECORD);
    const transaction = database.last();
    const getAll = transaction.requests[0]?.request as FakeRequest;
    getAll.result = [{ bytes: 1 }, { bytes: 1 }, { bytes: 1 }];
    getAll.onsuccess?.();
    expect(transaction.requests.map(({ method }) => method)).toEqual(["getAll"]);
    transaction.oncomplete?.();
    await expect(putting).resolves.toBe("full");
  });

  test("resolves failed when the transaction aborts", async () => {
    const { store, database } = await openFake();
    const putting = store.put(RECORD);
    database.last().onabort?.();
    await expect(putting).resolves.toBe("failed");
  });

  test("resolves failed when the connection refuses a transaction", async () => {
    const { store, database } = await openFake();
    database.refuse = true;
    await expect(store.put(RECORD)).resolves.toBe("failed");
  });
});

describe("oldest", () => {
  test("reads the first body of the key index", async () => {
    const { store, database } = await openFake();
    const reading = store.oldest(RECORD.key);
    const transaction = database.last();
    expect(transaction.mode).toBe("readonly");
    const get = transaction.requests[0];
    expect(get).toMatchObject({ method: "get", args: [RECORD.key] });
    const stored = { ...RECORD, id: 1, bytes: 5 };
    (get?.request as FakeRequest).result = stored;
    get?.request.onsuccess?.();
    await expect(reading).resolves.toEqual(stored);
  });

  test("resolves undefined when the transaction aborts", async () => {
    const { store, database } = await openFake();
    const reading = store.oldest(RECORD.key);
    database.last().onabort?.();
    await expect(reading).resolves.toBeUndefined();
  });

  test("resolves undefined when the connection refuses a transaction", async () => {
    const { store, database } = await openFake();
    database.refuse = true;
    await expect(store.oldest(RECORD.key)).resolves.toBeUndefined();
  });
});

describe("delete", () => {
  test("deletes the id and resolves once the transaction completes", async () => {
    const { store, database } = await openFake();
    const deleting = store.delete(7);
    const transaction = database.last();
    expect(transaction.mode).toBe("readwrite");
    expect(transaction.requests[0]).toMatchObject({ method: "delete", args: [7] });
    transaction.oncomplete?.();
    await expect(deleting).resolves.toBeUndefined();
  });

  test("resolves when the transaction aborts", async () => {
    const { store, database } = await openFake();
    const deleting = store.delete(7);
    database.last().onabort?.();
    await expect(deleting).resolves.toBeUndefined();
  });

  test("resolves when the connection refuses a transaction", async () => {
    const { store, database } = await openFake();
    database.refuse = true;
    await expect(store.delete(7)).resolves.toBeUndefined();
  });
});

describe("a closed connection", () => {
  test("a versionchange closes the connection, and later calls start no transaction", async () => {
    const { store, database } = await openFake();
    database.onversionchange?.();
    expect(database.closed).toBe(1);
    await expect(store.put(RECORD)).resolves.toBe("failed");
    await expect(store.oldest(RECORD.key)).resolves.toBeUndefined();
    await expect(store.delete(1)).resolves.toBeUndefined();
    expect(database.transactions).toEqual([]);
  });

  test("close closes the connection, and later calls start no transaction", async () => {
    const { store, database } = await openFake();
    store.close();
    expect(database.closed).toBe(1);
    await expect(store.put(RECORD)).resolves.toBe("failed");
    await expect(store.oldest(RECORD.key)).resolves.toBeUndefined();
    await expect(store.delete(1)).resolves.toBeUndefined();
    expect(database.transactions).toEqual([]);
  });
});
