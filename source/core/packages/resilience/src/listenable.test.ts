import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { createEmitter } from "./listenable";
import type { ExecutionContext, Outcome, Policy } from "./types";

describe("createEmitter", () => {
  test("delivers an event to every listener in registration order", () => {
    const { listenable, emit } = createEmitter<number>();
    const seen: string[] = [];
    listenable.on((e) => seen.push(`a${e}`));
    listenable.on((e) => seen.push(`b${e}`));
    emit(1);
    expect(seen).toEqual(["a1", "b1"]);
  });

  test("swallows a throwing listener and still runs the others", () => {
    const { listenable, emit } = createEmitter<number>();
    const after = vi.fn();
    listenable.on(() => {
      throw new Error("boom");
    });
    listenable.on(after);
    expect(() => emit(1)).not.toThrow();
    expect(after).toHaveBeenCalledWith(1);
  });

  test("unsubscribe stops delivery and is idempotent", () => {
    const { listenable, emit } = createEmitter<number>();
    const listener = vi.fn();
    const other = vi.fn();
    const off = listenable.on(listener);
    listenable.on(other);
    off();
    off();
    emit(1);
    expect(listener).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  test("a listener added during emit is not called for that event", () => {
    const { listenable, emit } = createEmitter<number>();
    const late = vi.fn();
    listenable.on(() => {
      listenable.on(late);
    });
    emit(1);
    expect(late).not.toHaveBeenCalled();
    emit(2);
    expect(late).toHaveBeenCalledWith(2);
  });

  test("a listener removed during emit still receives the current event, not the next", () => {
    const { listenable, emit } = createEmitter<number>();
    const victim = vi.fn();
    let offVictim: () => void = () => {};
    listenable.on(() => offVictim());
    offVictim = listenable.on(victim);
    emit(1);
    expect(victim).toHaveBeenCalledTimes(1);
    emit(2);
    expect(victim).toHaveBeenCalledTimes(1);
  });

  test("registering the same function twice makes two independent subscriptions", () => {
    const { listenable, emit } = createEmitter<number>();
    const listener = vi.fn();
    const offFirst = listenable.on(listener);
    listenable.on(listener);
    emit(1);
    expect(listener).toHaveBeenCalledTimes(2);
    offFirst();
    offFirst();
    emit(2);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("shared types", () => {
  test("Outcome narrows on ok and Policy.execute infers the operation's result", () => {
    const outcome = { ok: true, value: 1 } as Outcome<number>;
    if (outcome.ok) {
      expectTypeOf(outcome.value).toEqualTypeOf<number>();
    } else {
      expectTypeOf(outcome.error).toBeUnknown();
    }
    expectTypeOf<ExecutionContext["attempt"]>().toBeNumber();
    expectTypeOf<Policy["execute"]>().toBeFunction();
  });
});
