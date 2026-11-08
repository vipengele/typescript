import { breadcrumbs, Scope } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { afterEach, describe, expect, test } from "vitest";
import { suppressBreadcrumbs } from "../../../breadcrumb-suppression";
import { type ConsoleInstrumentationOptions, type ConsoleTarget, installConsole } from "./console";

const uninstalls: (() => void)[] = [];

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) {
    uninstall();
  }
});

/** A stand-in console whose methods log what they were called with and on what. */
function fakeConsole() {
  const calls: { method: string; self: unknown; args: unknown[] }[] = [];
  const method = (name: string) =>
    function (this: unknown, ...args: unknown[]): string {
      calls.push({ method: name, self: this, args });
      return `returned by ${name}`;
    };
  const target = { debug: method("debug"), info: method("info"), log: method("log"), warn: method("warn"), error: method("error") };
  return { target, calls };
}

function installed(options: ConsoleInstrumentationOptions, target: ConsoleTarget): void {
  uninstalls.push(installConsole(options, target));
}

/** Runs `fn` in a fresh Unit of Work and returns the trail it left. */
function trailOf(fn: () => void) {
  return Scope.isolated("test", {}, () => {
    fn();
    return breadcrumbs(Scope.current());
  });
}

describe("installConsole", () => {
  test("records each method at its level in category console, timed by the clock", () => {
    const time = createManualTime(1_000);
    const { target } = fakeConsole();
    installed({ clock: time.clock }, target);

    const trail = trailOf(() => {
      target.debug("d");
      target.info("i");
      target.log("l");
      target.warn("w");
      target.error("e");
    });

    expect(trail).toEqual([
      { time: 1_000, category: "console", level: "debug", message: "d" },
      { time: 1_000, category: "console", level: "info", message: "i" },
      { time: 1_000, category: "console", level: "info", message: "l" },
      { time: 1_000, category: "console", level: "warn", message: "w" },
      { time: 1_000, category: "console", level: "error", message: "e" },
    ]);
  });

  test("calls the original with the same this and arguments and returns its value", () => {
    const { target, calls } = fakeConsole();
    installed({ clock: () => 0 }, target);

    const returned = trailOf(() => {
      expect(target.log("a", 1)).toBe("returned by log");
    });

    expect(returned).toHaveLength(1);
    expect(calls).toEqual([{ method: "log", self: target, args: ["a", 1] }]);
  });

  test("lets a throw from the original propagate after recording", () => {
    const failure = new Error("original failed");
    const target: ConsoleTarget = {
      error() {
        throw failure;
      },
    };
    installed({ clock: () => 0 }, target);

    const trail = trailOf(() => {
      expect(() => target.error?.("x")).toThrow(failure);
    });

    expect(trail.map((crumb) => crumb.message)).toEqual(["x"]);
  });

  test("renders strings verbatim, errors as name: message and other values as JSON", () => {
    const { target } = fakeConsole();
    installed({ clock: () => 0 }, target);

    const [crumb] = trailOf(() => {
      target.log("text", new TypeError("bad"), { a: [1, 2] }, 3, null, undefined);
    });

    expect(crumb?.message).toBe('text TypeError: bad {"a":[1,2]} 3 null undefined');
  });

  test("falls back to String for a value JSON cannot render", () => {
    const { target } = fakeConsole();
    installed({ clock: () => 0 }, target);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const [crumb] = trailOf(() => {
      target.log(10n, cyclic, () => 1);
    });

    expect(crumb?.message).toBe("10 [object Object] () => 1");
  });

  test("renders a value neither JSON nor String can render as a placeholder", () => {
    const { target } = fakeConsole();
    installed({ clock: () => 0 }, target);
    const hostile = {
      toJSON() {
        throw new Error("no json");
      },
      toString() {
        throw new Error("no string");
      },
    };

    const [crumb] = trailOf(() => {
      target.log("before", hostile);
    });

    expect(crumb?.message).toBe("before [unrenderable]");
  });

  test("bounds how much of a large value JSON visits", () => {
    const { target } = fakeConsole();
    installed({ clock: () => 0 }, target);
    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`k${index}`, index]));

    const [crumb] = trailOf(() => {
      target.log(wide);
    });

    expect(crumb?.message).toContain('"k0":0');
    expect(crumb?.message).not.toContain('"k300"');
  });

  test("caps the message at 1000 characters and stops rendering past the cap", () => {
    const { target } = fakeConsole();
    installed({ clock: () => 0 }, target);
    let rendered = false;
    const late = {
      toJSON() {
        rendered = true;
        return "late";
      },
    };

    const [crumb] = trailOf(() => {
      target.log("x".repeat(600), "y".repeat(600), late);
    });

    expect(crumb?.message).toBe(`${"x".repeat(600)} ${"y".repeat(399)}`);
    expect(rendered).toBe(false);
  });

  test("records nothing for a call made while breadcrumbs are suppressed, and still calls the original", () => {
    const { target, calls } = fakeConsole();
    installed({ clock: () => 0 }, target);

    const trail = trailOf(() => {
      suppressBreadcrumbs(() => target.warn("internal"));
    });

    expect(trail).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test("skips a method whose assignment throws and patches the others", () => {
    const { target, calls } = fakeConsole();
    const frozenWarn = target.warn;
    Object.defineProperty(target, "warn", { value: frozenWarn, writable: false });
    installed({ clock: () => 0 }, target);

    const trail = trailOf(() => {
      target.warn("unpatched");
      target.info("patched");
    });

    expect(target.warn).toBe(frozenWarn);
    expect(trail.map((crumb) => crumb.message)).toEqual(["patched"]);
    expect(calls.map((call) => call.method)).toEqual(["warn", "info"]);
  });

  test("restores the originals when the last install leaves", () => {
    const { target } = fakeConsole();
    const original = target.log;
    const uninstall = installConsole({ clock: () => 0 }, target);

    expect(target.log).not.toBe(original);
    uninstall();

    expect(target.log).toBe(original);
  });

  test("a wrapper left under another party's wrapper records nothing once uninstalled", () => {
    const { target, calls } = fakeConsole();
    const uninstall = installConsole({ clock: () => 0 }, target);
    const ours = target.log;
    target.log = (...args: unknown[]) => ours.apply(target, args);
    uninstall();

    const trail = trailOf(() => {
      target.log("after");
    });

    expect(trail).toEqual([]);
    expect(calls.map((call) => call.args)).toEqual([["after"]]);
  });

  test("reads a missing clock, as another copy's entry may have, as the system clock", () => {
    const { target } = fakeConsole();
    installed({} as ConsoleInstrumentationOptions, target);
    const before = Date.now();

    const [crumb] = trailOf(() => {
      target.log("m");
    });

    expect(crumb?.time).toBeGreaterThanOrEqual(before);
  });

  test("swallows a clock that throws and still calls the original", () => {
    const { target, calls } = fakeConsole();
    installed(
      {
        clock: () => {
          throw new Error("clock failed");
        },
      },
      target,
    );

    const trail = trailOf(() => {
      expect(target.log("m")).toBe("returned by log");
    });

    expect(trail).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test("installs nothing on a target that is not an object", () => {
    const uninstall = installConsole({ clock: () => 0 }, null as unknown as ConsoleTarget);

    expect(() => uninstall()).not.toThrow();
  });

  test("patches the realm's console by default", () => {
    const original = globalThis.console.info;
    const uninstall = installConsole({ clock: () => 0 });
    try {
      expect(globalThis.console.info).not.toBe(original);
    } finally {
      uninstall();
    }

    expect(globalThis.console.info).toBe(original);
  });
});
