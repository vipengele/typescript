import { afterEach, describe, expect, test } from "vitest";
import { type OfflineLimits, type OfflineStore, openOfflineStore } from "./store";

// Browser-only: the real `indexedDB`, one database per test, deleted afterwards. The suite in
// both runtimes covers every failure path against a scripted factory.

const LOGS = "https://collector.example/v1/logs|logs";
const ERRORS = "https://collector.example/v1/logs|errors";

const opened: { store: OfflineStore; name: string }[] = [];

function settled(request: IDBRequest | IDBOpenDBRequest): Promise<void> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

afterEach(async () => {
  for (const { store, name } of opened.splice(0)) {
    store.close();
    await settled(indexedDB.deleteDatabase(name));
  }
});

async function open(limits: OfflineLimits = { maxEntries: 30, maxBytes: 1_048_576 }) {
  const name = `vipengele-store-test-${crypto.randomUUID()}`;
  const store = await openOfflineStore(indexedDB, name, limits);
  if (store === undefined) {
    throw new Error("the store did not open");
  }
  opened.push({ store, name });
  return { store, name };
}

function body(key: string, text: string, storedAt = 1000) {
  return { key, body: text, count: 1, storedAt };
}

describe("openOfflineStore against indexedDB", () => {
  test("oldest is undefined for a key with nothing stored", async () => {
    const { store } = await open();
    await expect(store.oldest(LOGS)).resolves.toBeUndefined();
  });

  test("reads back what was stored, with an id and its UTF-8 length", async () => {
    const { store } = await open();
    await expect(store.put({ key: LOGS, body: '["é"]', count: 3, storedAt: 1234 })).resolves.toBe("stored");
    const oldest = await store.oldest(LOGS);
    expect(oldest).toEqual({ id: expect.any(Number), key: LOGS, body: '["é"]', count: 3, bytes: 6, storedAt: 1234 });
  });

  test("oldest returns bodies of a key in the order they were stored", async () => {
    const { store } = await open();
    await store.put(body(LOGS, "first", 2000));
    await store.put(body(LOGS, "second", 1000));
    await store.put(body(LOGS, "third", 3000));
    const seen: string[] = [];
    for (let next = await store.oldest(LOGS); next !== undefined; next = await store.oldest(LOGS)) {
      seen.push(next.body);
      await store.delete(next.id);
    }
    expect(seen).toEqual(["first", "second", "third"]);
  });

  test("a key reads back only its own bodies", async () => {
    const { store } = await open();
    await store.put(body(ERRORS, "error"));
    await store.put(body(LOGS, "log"));
    expect((await store.oldest(LOGS))?.body).toBe("log");
    const error = await store.oldest(ERRORS);
    expect(error?.body).toBe("error");
    await store.delete(error?.id as number);
    await expect(store.oldest(ERRORS)).resolves.toBeUndefined();
    expect((await store.oldest(LOGS))?.body).toBe("log");
  });

  test("deleting an id that is not stored resolves", async () => {
    const { store } = await open();
    await expect(store.delete(42)).resolves.toBeUndefined();
  });

  test("the entry bound counts every key and keeps the oldest", async () => {
    const { store } = await open({ maxEntries: 2, maxBytes: 1000 });
    await expect(store.put(body(LOGS, "a"))).resolves.toBe("stored");
    await expect(store.put(body(ERRORS, "b"))).resolves.toBe("stored");
    await expect(store.put(body(LOGS, "c"))).resolves.toBe("full");
    const oldest = await store.oldest(LOGS);
    expect(oldest?.body).toBe("a");
    await store.delete(oldest?.id as number);
    await expect(store.oldest(LOGS)).resolves.toBeUndefined();
    await expect(store.put(body(LOGS, "c"))).resolves.toBe("stored");
    expect((await store.oldest(LOGS))?.body).toBe("c");
  });

  test("the byte bound counts UTF-8 bytes across every key and keeps the oldest", async () => {
    const { store } = await open({ maxEntries: 30, maxBytes: 6 });
    await expect(store.put(body(LOGS, "éé"))).resolves.toBe("stored");
    await expect(store.put(body(ERRORS, "é"))).resolves.toBe("stored");
    await expect(store.put(body(LOGS, "é"))).resolves.toBe("full");
    await expect(store.put(body(LOGS, "x"))).resolves.toBe("full");
    const errors = await store.oldest(ERRORS);
    await store.delete(errors?.id as number);
    await expect(store.put(body(LOGS, "x"))).resolves.toBe("stored");
    await expect(store.put(body(LOGS, "y"))).resolves.toBe("stored");
  });

  test("a body larger than the byte bound alone is full", async () => {
    const { store } = await open({ maxEntries: 30, maxBytes: 3 });
    await expect(store.put(body(LOGS, "four"))).resolves.toBe("full");
    await expect(store.oldest(LOGS)).resolves.toBeUndefined();
  });

  test("a second store on the same database sees what the first stored", async () => {
    const { store, name } = await open();
    await store.put(body(LOGS, "shared"));
    const other = await openOfflineStore(indexedDB, name, { maxEntries: 30, maxBytes: 1000 });
    expect((await other?.oldest(LOGS))?.body).toBe("shared");
    other?.close();
  });

  test("an upgrade from another connection closes the store, which then fails every call", async () => {
    const { store, name } = await open();
    await store.put(body(LOGS, "kept"));
    const upgrade = indexedDB.open(name, 2);
    await settled(upgrade);
    upgrade.result.close();
    await expect(store.put(body(LOGS, "late"))).resolves.toBe("failed");
    await expect(store.oldest(LOGS)).resolves.toBeUndefined();
    await expect(store.delete(1)).resolves.toBeUndefined();
  });
});
