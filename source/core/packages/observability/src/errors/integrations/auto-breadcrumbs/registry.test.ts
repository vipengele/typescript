import { afterEach, describe, expect, test, vi } from "vitest";
import { type InstallEntry, type InstrumentationType, activeOptions, install, patchProperties } from "./registry";

interface Options {
  readonly name: string;
}

interface SlotView {
  installs: InstallEntry[];
  patch: { restore: () => void } | undefined;
}

const TYPES: readonly InstrumentationType[] = ["console", "fetch", "xhr", "navigation", "clicks"];
const registry = globalThis as unknown as Record<symbol, SlotView | undefined>;

function slotKey(type: InstrumentationType): symbol {
  return Symbol.for(`vipengele:breadcrumbs:instrumentation:${type}:v1`);
}

/** The slot as another copy of the package sees it: the same `Symbol.for` key on `globalThis`. */
function otherCopySlot(type: InstrumentationType): SlotView {
  const key = slotKey(type);
  registry[key] ??= { installs: [], patch: undefined };
  return registry[key];
}

/** A stand-in global with one method, patched the way an instrumentation patches a real one. */
function fakeGlobal() {
  const calls: string[] = [];
  const target = {
    send(value: string): string {
      calls.push(value);
      return `sent ${value}`;
    },
  };
  return { target, original: target.send, calls };
}

afterEach(() => {
  for (const type of TYPES) {
    delete registry[slotKey(type)];
  }
});

describe("install", () => {
  test("the first install patches; a later one only joins the list", () => {
    const patch = vi.fn(() => () => {});

    install<Options>("fetch", { name: "a" }, patch);
    install<Options>("fetch", { name: "b" }, patch);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(otherCopySlot("fetch").installs.map((entry) => entry.options)).toEqual([{ name: "a" }, { name: "b" }]);
  });

  test("keeps its state in the type's Symbol.for slot on globalThis", () => {
    install<Options>("console", { name: "a" }, () => () => {});

    expect(registry[slotKey("console")]?.installs).toEqual([{ options: { name: "a" } }]);
    expect(registry[slotKey("fetch")]).toBeUndefined();
  });

  test("the oldest live install's options apply, and tearing it down hands over to the next", () => {
    let read: () => Options | undefined = () => undefined;
    const first = install<Options>("fetch", { name: "a" }, (options) => {
      read = options;
      return () => {};
    });
    const second = install<Options>("fetch", { name: "b" }, () => () => {});
    install<Options>("fetch", { name: "c" }, () => () => {});

    expect(read()).toEqual({ name: "a" });
    expect(activeOptions<Options>("fetch")).toEqual({ name: "a" });

    second();
    expect(read()).toEqual({ name: "a" });

    first();
    expect(read()).toEqual({ name: "c" });
    expect(activeOptions<Options>("fetch")).toEqual({ name: "c" });
  });

  test("the last uninstall restores, once, and a later install patches afresh", () => {
    const restore = vi.fn();
    const patch = vi.fn(() => restore);
    const first = install<Options>("xhr", { name: "a" }, patch);
    const second = install<Options>("xhr", { name: "b" }, patch);

    first();
    expect(restore).not.toHaveBeenCalled();
    second();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(activeOptions("xhr")).toBeUndefined();
    expect(otherCopySlot("xhr").patch).toBeUndefined();

    install<Options>("xhr", { name: "c" }, patch);
    expect(patch).toHaveBeenCalledTimes(2);
  });

  test("uninstalling twice is a no-op", () => {
    const restore = vi.fn();
    const first = install<Options>("console", { name: "a" }, () => restore);
    first();
    install<Options>("console", { name: "b" }, () => restore);

    first();

    expect(restore).toHaveBeenCalledTimes(1);
    expect(activeOptions<Options>("console")).toEqual({ name: "b" });
  });

  test("a patch that patches nothing joins nothing, and the next install tries again", () => {
    const patch = vi.fn<() => (() => void) | undefined>(() => undefined);

    const uninstall = install<Options>("navigation", { name: "a" }, patch);

    expect(activeOptions("navigation")).toBeUndefined();
    expect(() => uninstall()).not.toThrow();

    patch.mockReturnValueOnce(() => {});
    install<Options>("navigation", { name: "b" }, patch);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(activeOptions<Options>("navigation")).toEqual({ name: "b" });
  });

  test("a patch that throws joins nothing", () => {
    const uninstall = install<Options>("clicks", { name: "a" }, () => {
      throw new Error("cannot patch");
    });

    expect(activeOptions("clicks")).toBeUndefined();
    expect(() => uninstall()).not.toThrow();
  });

  test("a restore that throws does not break uninstall, and the slot is still reset", () => {
    const uninstall = install<Options>("fetch", { name: "a" }, () => () => {
      throw new Error("cannot restore");
    });

    expect(() => uninstall()).not.toThrow();
    expect(otherCopySlot("fetch")).toEqual({ installs: [], patch: undefined });
  });

  test("options read while patching are undefined: the patch is not current until it returns", () => {
    let duringPatch: Options | undefined | "unread" = "unread";

    install<Options>("console", { name: "a" }, (options) => {
      duringPatch = options();
      return () => {};
    });

    expect(duringPatch).toBeUndefined();
  });

  test("a patch's options read undefined once it is no longer current, even after a later patch", () => {
    let staleRead: () => Options | undefined = () => undefined;
    const uninstall = install<Options>("fetch", { name: "a" }, (options) => {
      staleRead = options;
      return () => {};
    });
    uninstall();

    expect(staleRead()).toBeUndefined();

    let freshRead: () => Options | undefined = () => undefined;
    install<Options>("fetch", { name: "b" }, (options) => {
      freshRead = options;
      return () => {};
    });

    expect(staleRead()).toBeUndefined();
    expect(freshRead()).toEqual({ name: "b" });
  });
});

describe("across copies of the package", () => {
  test("an install joins a list another copy patched, without patching again, and reads its options", () => {
    const otherRestore = vi.fn();
    const slot = otherCopySlot("fetch");
    const otherEntry: InstallEntry = { options: { name: "other copy" } };
    slot.installs.push(otherEntry);
    slot.patch = { restore: otherRestore };
    const patch = vi.fn(() => () => {});

    const uninstall = install<Options>("fetch", { name: "this copy" }, patch);

    expect(patch).not.toHaveBeenCalled();
    expect(activeOptions<Options>("fetch")).toEqual({ name: "other copy" });

    uninstall();
    expect(slot.installs).toEqual([otherEntry]);
    expect(otherRestore).not.toHaveBeenCalled();
  });

  test("the last install to leave restores the patch another copy made", () => {
    const otherRestore = vi.fn();
    const slot = otherCopySlot("console");
    const otherEntry: InstallEntry = { options: { name: "other copy" } };
    slot.installs.push(otherEntry);
    slot.patch = { restore: otherRestore };
    const uninstall = install<Options>("console", { name: "this copy" }, () => () => {});

    slot.installs.splice(slot.installs.indexOf(otherEntry), 1);
    uninstall();

    expect(otherRestore).toHaveBeenCalledTimes(1);
    expect(slot.patch).toBeUndefined();
  });

  test("another copy's install hands over to this copy's options when it leaves", () => {
    let read: () => Options | undefined = () => undefined;
    install<Options>("xhr", { name: "this copy" }, (options) => {
      read = options;
      return () => {};
    });
    const slot = otherCopySlot("xhr");
    const otherEntry: InstallEntry = { options: { name: "other copy" } };
    slot.installs.unshift(otherEntry);

    expect(read()).toEqual({ name: "other copy" });

    slot.installs.splice(slot.installs.indexOf(otherEntry), 1);
    expect(read()).toEqual({ name: "this copy" });
  });

  test("leaving a list that holds no patch restores nothing", () => {
    otherCopySlot("navigation").installs.push({ options: { name: "other copy" } });
    const uninstall = install<Options>("navigation", { name: "this copy" }, () => () => {});
    otherCopySlot("navigation").installs.shift();

    expect(() => uninstall()).not.toThrow();
    expect(otherCopySlot("navigation")).toEqual({ installs: [], patch: undefined });
  });

  test("a current patch whose list another copy emptied reads no options", () => {
    let read: () => Options | undefined = () => ({ name: "unread" });
    install<Options>("clicks", { name: "a" }, (options) => {
      read = options;
      return () => {};
    });

    otherCopySlot("clicks").installs.length = 0;

    expect(read()).toBeUndefined();
  });

  test("an uninstall whose slot another copy replaced finds nothing to remove", () => {
    const restore = vi.fn();
    const uninstall = install<Options>("fetch", { name: "a" }, () => restore);
    delete registry[slotKey("fetch")];

    uninstall();

    expect(restore).not.toHaveBeenCalled();
  });
});

describe("patchProperties", () => {
  test("wraps each named method, and the restore puts the originals back", () => {
    const { target, original, calls } = fakeGlobal();
    const seen: string[] = [];

    const restore = patchProperties(target, ["send"], (method, key) => {
      const wrapped = method as (this: unknown, value: string) => string;
      return function (this: unknown, value: string): string {
        seen.push(`${key}:${value}`);
        return wrapped.call(this, value);
      };
    });

    expect(target.send).not.toBe(original);
    expect(target.send("x")).toBe("sent x");
    expect(calls).toEqual(["x"]);
    expect(seen).toEqual(["send:x"]);

    restore?.();
    expect(target.send).toBe(original);
  });

  test("leaves a method re-wrapped by someone else in place on restore", () => {
    const { target } = fakeGlobal();
    const restore = patchProperties(target, ["send"], (method) => method);
    const ours = target.send;
    const theirs = (value: string): string => `theirs ${ours(value)}`;
    target.send = theirs;

    restore?.();

    expect(target.send).toBe(theirs);
  });

  test("returns undefined when no key could be patched", () => {
    const frozen = Object.freeze({ send: () => "frozen" });

    expect(patchProperties(frozen, ["send"], (method) => () => method())).toBeUndefined();
    expect(patchProperties({ send: "not a method" }, ["send", "missing"], (method) => method)).toBeUndefined();
  });

  test("skips a key whose assignment throws or does not take, and patches the rest", () => {
    const target: Record<string, unknown> = { kept: () => "kept" };
    Object.defineProperty(target, "readOnly", { value: () => "read only", writable: false });
    Object.defineProperty(target, "ignoring", { get: () => () => "ignoring", set: () => {} });
    Object.defineProperty(target, "throwingRead", {
      get: () => {
        throw new Error("unreadable");
      },
    });
    const originalKept = target.kept;
    const wrapped: string[] = [];

    const restore = patchProperties(target, ["readOnly", "ignoring", "throwingRead", "kept"], (method, key) => {
      wrapped.push(key);
      return () => method();
    });

    expect(wrapped).toEqual(["readOnly", "ignoring", "kept"]);
    expect(target.kept).not.toBe(originalKept);
    restore?.();
    expect(target.kept).toBe(originalKept);
  });

  test("skips a key whose wrap throws", () => {
    const { target, original } = fakeGlobal();

    const restore = patchProperties(target, ["send"], () => {
      throw new Error("cannot wrap");
    });

    expect(restore).toBeUndefined();
    expect(target.send).toBe(original);
  });

  test("a restore that cannot assign a key still restores the others and does not throw", () => {
    const target: Record<string, unknown> = { first: () => "first", second: () => "second" };
    const originalSecond = target.second;
    const restore = patchProperties(target, ["first", "second"], (method) => () => method());
    const ourFirst = target.first;
    Object.defineProperty(target, "first", { writable: false });

    expect(() => restore?.()).not.toThrow();
    expect(target.first).toBe(ourFirst);
    expect(target.second).toBe(originalSecond);
  });

  test("with install, the last uninstall leaves a re-wrapped global wrapped, and its wrapper inert", () => {
    const { target, original } = fakeGlobal();
    const recorded: string[] = [];
    const uninstall = install<Options>("fetch", { name: "a" }, (options) =>
      patchProperties(target, ["send"], (method) => {
        const wrapped = method as (value: string) => string;
        return (value: string): string => {
          const active = options();
          if (active !== undefined) {
            recorded.push(`${active.name}:${value}`);
          }
          return wrapped(value);
        };
      }),
    );
    const ours = target.send;
    const theirs = (value: string): string => ours(value);
    target.send = theirs;

    target.send("before");
    uninstall();
    target.send("after");

    expect(target.send).toBe(theirs);
    expect(target.send).not.toBe(original);
    expect(recorded).toEqual(["a:before"]);
  });
});
