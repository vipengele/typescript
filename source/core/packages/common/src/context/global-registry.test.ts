import { expect, test, vi } from "vitest";
import { createSyncStackCarrier } from "./carriers/sync-stack-carrier";
import { getOrCreateRegistryEntry } from "./global-registry";

let keys = 0;

/** A key no other test has used, since registry slots live on globalThis for the whole run. */
function freshKey(): string {
  keys += 1;
  return `global-registry-test-${keys}`;
}

test("the first call fills the slot with createDefault's carrier", () => {
  const carrier = createSyncStackCarrier("default");

  expect(getOrCreateRegistryEntry(freshKey(), () => carrier).get()).toBe(carrier);
});

test("a second call with the same key sees the first call's carrier and never invokes its createDefault", () => {
  const key = freshKey();
  const first = createSyncStackCarrier("first");
  const createSecond = vi.fn(() => createSyncStackCarrier("second"));

  const a = getOrCreateRegistryEntry(key, () => first);
  const b = getOrCreateRegistryEntry(key, createSecond);

  expect(b.get()).toBe(first);
  expect(a.get()).toBe(b.get());
  expect(createSecond).not.toHaveBeenCalled();
});

test("set through one handle is visible through every other handle for the key", () => {
  const key = freshKey();
  const a = getOrCreateRegistryEntry(key, () => createSyncStackCarrier("default"));
  const b = getOrCreateRegistryEntry(key, () => createSyncStackCarrier("default"));
  const override = createSyncStackCarrier("override");

  a.set(override);

  expect(b.get()).toBe(override);
});

test("different keys hold independent carriers", () => {
  const keyA = freshKey();
  const keyB = freshKey();
  const a = getOrCreateRegistryEntry(keyA, () => createSyncStackCarrier("a"));
  const b = getOrCreateRegistryEntry(keyB, () => createSyncStackCarrier("b"));

  a.set(createSyncStackCarrier("override"));

  expect(b.get().current()).toBe("b");
  expect(a.get().current()).toBe("override");
});

test("the slot is the Symbol.for key another copy of the package derives from the same string", () => {
  const key = freshKey();
  const carrier = createSyncStackCarrier("default");

  getOrCreateRegistryEntry(key, () => carrier);

  expect((globalThis as unknown as Record<symbol, unknown>)[Symbol.for(`vipengele:async-context-store:${key}`)]).toBe(carrier);
});
