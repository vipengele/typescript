// biome-ignore-all lint/security/noSecrets: every fixture is a URL, flagged only for its entropy
import { breadcrumbs, Scope } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { afterEach, describe, expect, test } from "vitest";
import { suppressBreadcrumbs } from "../../../breadcrumb-suppression";
import { installNavigation, type NavigationInstrumentationOptions, type NavigationTarget } from "./navigation";

const uninstalls: (() => void)[] = [];

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) {
    uninstall();
  }
});

/**
 * A stand-in window: a `location` whose `href` the stand-in `history` moves, resolving a relative
 * URL against it, and `popstate` listeners that `pop(url)` fires after moving `href` itself.
 */
function fakeWindow(start = "https://app.example.com/") {
  const location = { href: start };
  const calls: { method: string; self: unknown; args: unknown[] }[] = [];
  const listeners = new Set<() => void>();
  const history = {
    pushState(...args: unknown[]): string {
      calls.push({ method: "pushState", self: this, args });
      if (args[2] === "throw") {
        throw new Error("SecurityError");
      }
      if (args[2] !== undefined) {
        location.href = new URL(String(args[2]), location.href).href;
      }
      return "pushed";
    },
    replaceState(...args: unknown[]): string {
      calls.push({ method: "replaceState", self: this, args });
      if (args[2] !== undefined) {
        location.href = new URL(String(args[2]), location.href).href;
      }
      return "replaced";
    },
  };
  const target = {
    history,
    location,
    addEventListener(type: string, listener: () => void) {
      if (type === "popstate") {
        listeners.add(listener);
      }
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === "popstate") {
        listeners.delete(listener);
      }
    },
  } satisfies NavigationTarget;
  const pop = (url: string): void => {
    location.href = url;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return { target, history, location, listeners, calls, pop };
}

function options(clock = () => 0, redaction: RedactionPolicy = secretKeys): NavigationInstrumentationOptions {
  return { clock, redaction };
}

function installed(given: NavigationInstrumentationOptions, target: NavigationTarget): () => void {
  const uninstall = installNavigation(given, target);
  uninstalls.push(uninstall);
  return uninstall;
}

/** Runs `fn` in a fresh Unit of Work, synchronously, and returns the trail it left. */
function trailOf(fn: () => void) {
  return Scope.isolated("test", {}, () => {
    fn();
    return breadcrumbs(Scope.current());
  });
}

describe("installNavigation", () => {
  test("records pushState with the redacted URLs before and after the call", () => {
    const time = createManualTime(9_000);
    const { target, history } = fakeWindow("https://app.example.com/login?token=abc");
    installed(options(time.clock), target);

    const trail = trailOf(() => history.pushState(null, "", "/home?page=2"));

    expect(trail).toEqual([
      {
        time: 9_000,
        category: "navigation",
        level: "info",
        message: "https://app.example.com/login?token=[REDACTED] → https://app.example.com/home?page=2",
        data: { from: "https://app.example.com/login?token=[REDACTED]", to: "https://app.example.com/home?page=2" },
      },
    ]);
  });

  test("records replaceState", () => {
    const { target, history } = fakeWindow();
    installed(options(), target);

    const trail = trailOf(() => history.replaceState(null, "", "#section"));

    expect(trail.map((crumb) => crumb.data)).toEqual([{ from: "https://app.example.com/", to: "https://app.example.com/#section" }]);
  });

  test("calls the originals with the same this and arguments and returns what they return", () => {
    const { target, history, calls } = fakeWindow();
    installed(options(), target);

    expect(history.pushState({ a: 1 }, "t", "/a")).toBe("pushed");
    expect(history.replaceState({ b: 2 }, "u")).toBe("replaced");

    expect(calls).toEqual([
      { method: "pushState", self: history, args: [{ a: 1 }, "t", "/a"] },
      { method: "replaceState", self: history, args: [{ b: 2 }, "u"] },
    ]);
  });

  test("a call that throws rethrows and records nothing", () => {
    const { target, history } = fakeWindow();
    installed(options(), target);

    const trail = trailOf(() => {
      expect(() => history.pushState(null, "", "throw")).toThrow("SecurityError");
    });

    expect(trail).toEqual([]);
  });

  test("a navigation to the same URL records nothing", () => {
    const { target, history, pop } = fakeWindow();
    installed(options(), target);

    const trail = trailOf(() => {
      history.replaceState({ state: 1 }, "");
      history.pushState(null, "", "/");
      pop("https://app.example.com/");
    });

    expect(trail).toEqual([]);
  });

  test("popstate records from the last URL the patch saw to the current one", () => {
    const { target, history, pop } = fakeWindow();
    installed(options(), target);

    const trail = trailOf(() => {
      history.pushState(null, "", "/a");
      history.pushState(null, "", "/b");
      pop("https://app.example.com/a");
      pop("https://app.example.com/");
    });

    expect(trail.map((crumb) => crumb.message)).toEqual([
      "https://app.example.com/ → https://app.example.com/a",
      "https://app.example.com/a → https://app.example.com/b",
      "https://app.example.com/b → https://app.example.com/a",
      "https://app.example.com/a → https://app.example.com/",
    ]);
  });

  test("the last-known URL starts at the location when the patch is installed", () => {
    const { target, location, pop } = fakeWindow("https://app.example.com/start");
    installed(options(), target);
    location.href = "https://app.example.com/moved-unseen";

    const trail = trailOf(() => pop("https://app.example.com/back"));

    expect(trail.map((crumb) => crumb.data)).toEqual([{ from: "https://app.example.com/start", to: "https://app.example.com/back" }]);
  });

  test("a suppressed navigation records nothing but still moves the last-known URL", () => {
    const { target, history, pop } = fakeWindow();
    installed(options(), target);

    const trail = trailOf(() => {
      suppressBreadcrumbs(() => history.pushState(null, "", "/quiet"));
      suppressBreadcrumbs(() => pop("https://app.example.com/quieter"));
      pop("https://app.example.com/");
    });

    expect(trail.map((crumb) => crumb.data)).toEqual([{ from: "https://app.example.com/quieter", to: "https://app.example.com/" }]);
  });

  test("redacts both URLs with the options' policy, read at each navigation", () => {
    const { target, history } = fakeWindow("https://app.example.com/?code=1");
    const first = installed(
      options(() => 0, { keys: ["code"] }),
      target,
    );
    installed(
      options(() => 0, { keys: ["state"] }),
      target,
    );

    const trail = trailOf(() => {
      history.pushState(null, "", "/?state=2");
      first();
      history.pushState(null, "", "/?code=3");
    });

    expect(trail.map((crumb) => crumb.data)).toEqual([
      { from: "https://app.example.com/?code=[REDACTED]", to: "https://app.example.com/?state=2" },
      { from: "https://app.example.com/?state=[REDACTED]", to: "https://app.example.com/?code=3" },
    ]);
  });

  test("defaults a missing clock and redaction from another copy's entry", () => {
    const { target, history } = fakeWindow();
    installed({} as NavigationInstrumentationOptions, target);
    const before = Date.now();

    const [crumb] = trailOf(() => history.pushState(null, "", "/?password=p"));

    expect(crumb?.data).toEqual({ from: "https://app.example.com/", to: "https://app.example.com/?password=[REDACTED]" });
    expect(crumb?.time).toBeGreaterThanOrEqual(before);
  });

  test("a second install patches nothing more and each navigation records once", () => {
    const { target, history, listeners } = fakeWindow();
    installed(
      options(() => 1),
      target,
    );
    const wrapped = history.pushState;
    installed(
      options(() => 2),
      target,
    );

    const trail = trailOf(() => history.pushState(null, "", "/once"));

    expect(history.pushState).toBe(wrapped);
    expect(listeners.size).toBe(1);
    expect(trail.map((crumb) => crumb.time)).toEqual([1]);
  });

  test("the last install to leave restores both methods and removes the listener", () => {
    const { target, history, listeners } = fakeWindow();
    const { pushState, replaceState } = history;
    const first = installed(options(), target);
    const second = installed(options(), target);

    first();
    expect(history.pushState).not.toBe(pushState);
    second();

    expect(history.pushState).toBe(pushState);
    expect(history.replaceState).toBe(replaceState);
    expect(listeners.size).toBe(0);
  });

  test("wrappers and a listener left in place after teardown record nothing", () => {
    const { target, history, listeners, pop } = fakeWindow();
    const uninstall = installed(options(), target);
    const wrapper = history.pushState;
    const [listener] = [...listeners] as [() => void];
    const rewrapped = function (this: unknown, ...args: unknown[]) {
      return wrapper.apply(this, args);
    };
    history.pushState = rewrapped;

    uninstall();
    const trail = trailOf(() => {
      history.pushState(null, "", "/inert");
      pop("https://app.example.com/popped");
      listener();
    });

    expect(history.pushState).toBe(rewrapped);
    expect(trail).toEqual([]);
  });

  test("a frozen history leaves only the popstate half installed", () => {
    const { target, history, listeners, pop } = fakeWindow();
    Object.freeze(history);
    installed(options(), target);

    const trail = trailOf(() => pop("https://app.example.com/frozen"));

    expect(listeners.size).toBe(1);
    expect(trail.map((crumb) => crumb.data?.to)).toEqual(["https://app.example.com/frozen"]);
  });

  test("a target with no listener methods installs only the history half", () => {
    const { history, location } = fakeWindow();
    const { pushState } = history;
    const uninstall = installed(options(), { history, location });

    const trail = trailOf(() => history.pushState(null, "", "/history-only"));

    expect(trail).toHaveLength(1);
    uninstall();
    expect(history.pushState).toBe(pushState);
  });

  test("a target whose addEventListener throws installs only the history half", () => {
    const { history, location } = fakeWindow();
    installed(options(), {
      history,
      location,
      addEventListener() {
        throw new Error("denied");
      },
      removeEventListener() {},
    });

    expect(trailOf(() => history.pushState(null, "", "/x"))).toHaveLength(1);
  });

  test("a removeEventListener that throws still restores the history methods", () => {
    const { history, location } = fakeWindow();
    const { pushState } = history;
    const uninstall = installed(options(), {
      history,
      location,
      addEventListener() {},
      removeEventListener() {
        throw new Error("denied");
      },
    });

    expect(() => uninstall()).not.toThrow();
    expect(history.pushState).toBe(pushState);
  });

  test("an unreadable location href records nothing and keeps the last-known URL", () => {
    const { target, location, pop } = fakeWindow();
    installed(options(), target);
    let broken = true;
    let href = location.href;
    Object.defineProperty(location, "href", {
      get() {
        if (broken) {
          throw new Error("unreadable");
        }
        return href;
      },
      set(value: string) {
        href = value;
      },
    });

    const trail = trailOf(() => {
      pop("https://app.example.com/hidden");
      broken = false;
      pop("https://app.example.com/seen");
    });

    expect(trail.map((crumb) => crumb.data)).toEqual([{ from: "https://app.example.com/", to: "https://app.example.com/seen" }]);
  });

  test("a non-string href records nothing", () => {
    const { target, history, location } = fakeWindow();
    installed(options(), target);

    const trail = trailOf(() => {
      (location as { href: unknown }).href = 42;
      history.replaceState(null, "");
    });

    expect(trail).toEqual([]);
  });

  test("a throwing clock drops the crumb and never reaches the caller", () => {
    const { target, history } = fakeWindow();
    installed(
      options(() => {
        throw new Error("clock");
      }),
      target,
    );

    let result: unknown;
    const trail = trailOf(() => {
      result = history.pushState(null, "", "/a");
    });

    expect(result).toBe("pushed");
    expect(trail).toEqual([]);
  });

  test("installs nothing without a location, or without both a history and listener methods", () => {
    const { history } = fakeWindow();
    const { pushState } = history;

    installNavigation(options(), { history })();
    installNavigation(options(), { location: { href: "https://a.example/" } })();
    installNavigation(options(), null as unknown as NavigationTarget)();
    installNavigation(options(), {
      get location(): unknown {
        throw new Error("denied");
      },
    })();
    installNavigation(options(), {})();

    expect(history.pushState).toBe(pushState);
  });

  test("the default target installs on this runtime's globals and leaves them as found", () => {
    const pushState = globalThis.history?.pushState;

    installNavigation(options())();

    expect(globalThis.history?.pushState).toBe(pushState);
  });
});
