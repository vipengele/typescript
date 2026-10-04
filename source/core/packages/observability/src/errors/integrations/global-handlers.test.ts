import { detectCapability } from "@vipengele/ts-core-common/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationHost } from "../integration";
import { type GlobalEventTarget, type GlobalHandlersOptions, type GlobalProcess, globalHandlers } from "./global-handlers";

vi.mock("@vipengele/ts-core-common/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vipengele/ts-core-common/runtime")>();
  return { ...actual, detectCapability: vi.fn(actual.detectCapability) };
});

type Listener = (event: unknown) => void;

function aTarget() {
  const listeners = new Map<string, Set<Listener>>();
  const target: GlobalEventTarget = {
    addEventListener: vi.fn((type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    }),
  };
  const emit = (type: string, event: unknown) => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
  };
  const count = (type: string) => listeners.get(type)?.size ?? 0;
  return { target, emit, count };
}

function aHost() {
  return { capture: vi.fn<IntegrationHost["capture"]>(() => "id"), flush: vi.fn(async () => true) };
}

const exitPolicies = { onUncaught: "exit", onUnhandledRejection: "exit" } satisfies GlobalHandlersOptions;

function install(target: GlobalEventTarget, host = aHost()) {
  const teardown = globalHandlers({ ...exitPolicies, eventTarget: target }).setup(host);
  return { host, teardown };
}

function aProcess() {
  const listeners = new Map<string, Set<Listener>>();
  const process = {
    on: vi.fn((event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
    }),
    off: vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    }),
    exit: vi.fn<(code: number) => unknown>(),
  } satisfies GlobalProcess;
  const emit = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(value);
    }
  };
  const count = (event: string) => listeners.get(event)?.size ?? 0;
  return { process, emit, count };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise reaction run. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("globalHandlers in the browser", () => {
  it("is named globalHandlers", () => {
    expect(globalHandlers(exitPolicies).name).toBe("globalHandlers");
  });

  it("captures an error event's error as unhandled, at level error, under global.error", () => {
    const { target, emit } = aTarget();
    const { host } = install(target);
    const error = new Error("boom");

    emit("error", { error, message: "Uncaught Error: boom" });

    expect(host.capture).toHaveBeenCalledExactlyOnceWith(error, {
      mechanism: { handled: false, source: "global.error" },
      level: "error",
    });
  });

  it("captures a cross-origin error event without an error as an Error built from its message", () => {
    const { target, emit } = aTarget();
    const { host } = install(target);

    emit("error", { error: null, message: "Script error." });

    const [captured, context] = host.capture.mock.calls[0] ?? [];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe("Script error.");
    expect(context).toEqual({ mechanism: { handled: false, source: "global.error" }, level: "error" });
  });

  it("captures an unhandled rejection's reason as unhandled, at level error, under global.rejection", () => {
    const { target, emit } = aTarget();
    const { host } = install(target);
    const reason = new TypeError("rejected");

    emit("unhandledrejection", { reason });

    expect(host.capture).toHaveBeenCalledExactlyOnceWith(reason, {
      mechanism: { handled: false, source: "global.rejection" },
      level: "error",
    });
  });

  it("hands a rejection reason that is not an Error to the pipeline as it is", () => {
    const { target, emit } = aTarget();
    const { host } = install(target);
    const reason = { code: 42 };

    emit("unhandledrejection", { reason });
    emit("unhandledrejection", { reason: "plain string" });

    expect(host.capture.mock.calls.map(([captured]) => captured)).toEqual([reason, "plain string"]);
  });

  it("never calls preventDefault, so the browser still reports the error itself", () => {
    const { target, emit } = aTarget();
    install(target);
    const preventDefault = vi.fn();

    emit("error", { error: new Error("boom"), preventDefault });
    emit("unhandledrejection", { reason: new Error("rejected"), preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("listens the same way whichever exit policies it is given", () => {
    const { target, emit } = aTarget();
    const host = aHost();
    globalHandlers({ onUncaught: "continue", onUnhandledRejection: "continue", flushTimeoutMs: 1, eventTarget: target }).setup(host);

    emit("error", { error: new Error("boom") });

    expect(host.capture).toHaveBeenCalledOnce();
    expect(host.flush).not.toHaveBeenCalled();
  });

  it("removes both listeners on teardown, and captures nothing afterwards", () => {
    const { target, emit, count } = aTarget();
    const { host, teardown } = install(target);
    expect(count("error")).toBe(1);
    expect(count("unhandledrejection")).toBe(1);

    expect(teardown).toBeTypeOf("function");
    (teardown as () => void)();
    emit("error", { error: new Error("boom") });
    emit("unhandledrejection", { reason: new Error("rejected") });

    expect(count("error")).toBe(0);
    expect(count("unhandledrejection")).toBe(0);
    expect(host.capture).not.toHaveBeenCalled();
  });

  it("listens on globalThis when no event target is given and globalThis has addEventListener", () => {
    const { target, emit } = aTarget();
    vi.stubGlobal("addEventListener", target.addEventListener);
    vi.stubGlobal("removeEventListener", target.removeEventListener);
    const host = aHost();

    const teardown = globalHandlers(exitPolicies).setup(host);
    emit("unhandledrejection", { reason: "rejected" });
    (teardown as () => void)();

    expect(host.capture).toHaveBeenCalledOnce();
    expect(target.addEventListener).toHaveBeenCalledTimes(2);
    expect(target.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it("listens on an injected event target rather than an injected process", () => {
    const { target, count } = aTarget();
    const { process } = aProcess();

    globalHandlers({ ...exitPolicies, eventTarget: target, process }).setup(aHost());

    expect(count("error")).toBe(1);
    expect(process.on).not.toHaveBeenCalled();
  });

  it("installs nothing when nothing is injected, globalThis has no addEventListener and the runtime has no process exit hooks", () => {
    vi.stubGlobal("addEventListener", undefined);
    vi.mocked(detectCapability).mockReturnValueOnce(false);

    expect(globalHandlers(exitPolicies).setup(aHost())).toBeUndefined();
    expect(detectCapability).toHaveBeenCalledWith("processExitHooks");
  });
});

describe("globalHandlers in Node", () => {
  function installOn(process: GlobalProcess, options: Partial<GlobalHandlersOptions> = {}, host = aHost()) {
    const teardown = globalHandlers({ ...exitPolicies, ...options, process }).setup(host);
    return { host, teardown };
  }

  it("listens on an injected process rather than on globalThis's addEventListener", () => {
    const { target } = aTarget();
    vi.stubGlobal("addEventListener", target.addEventListener);
    const { process, count } = aProcess();

    installOn(process);

    expect(count("uncaughtException")).toBe(1);
    expect(count("unhandledRejection")).toBe(1);
    expect(target.addEventListener).not.toHaveBeenCalled();
  });

  it("registers both listeners whichever exit policies it is given", () => {
    const { process, count } = aProcess();

    installOn(process, { onUncaught: "continue", onUnhandledRejection: "continue" });

    expect(count("uncaughtException")).toBe(1);
    expect(count("unhandledRejection")).toBe(1);
  });

  it("captures an uncaught exception as unhandled, at level fatal, under global.error", () => {
    const { process, emit } = aProcess();
    const { host } = installOn(process, { onUncaught: "continue" });
    const error = new Error("boom");

    emit("uncaughtException", error);

    expect(host.capture).toHaveBeenCalledExactlyOnceWith(error, {
      mechanism: { handled: false, source: "global.error" },
      level: "fatal",
    });
  });

  it("captures an unhandled rejection's reason as unhandled, at level error, under global.rejection", () => {
    const { process, emit } = aProcess();
    const { host } = installOn(process, { onUnhandledRejection: "continue" });

    emit("unhandledRejection", "plain string");

    expect(host.capture).toHaveBeenCalledExactlyOnceWith("plain string", {
      mechanism: { handled: false, source: "global.rejection" },
      level: "error",
    });
  });

  it("keeps running under continue: it neither writes to the console, flushes nor exits", async () => {
    const { process, emit } = aProcess();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { host } = installOn(process, { onUncaught: "continue", onUnhandledRejection: "continue" });

    emit("uncaughtException", new Error("boom"));
    emit("unhandledRejection", new Error("rejected"));
    await settle();

    expect(host.capture).toHaveBeenCalledTimes(2);
    expect(consoleError).not.toHaveBeenCalled();
    expect(host.flush).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it.each([
    ["uncaughtException", { onUncaught: "exit", onUnhandledRejection: "continue" }],
    ["unhandledRejection", { onUncaught: "continue", onUnhandledRejection: "exit" }],
  ] as const)("under exit, %s writes to the console, then flushes, then exits with code 1", async (event, policies) => {
    const { process, emit } = aProcess();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const flush = deferred<boolean>();
    const host = { ...aHost(), flush: vi.fn(() => flush.promise) };
    installOn(process, policies, host);
    const error = new Error("boom");

    emit(event, error);

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(error);
    expect(host.flush).toHaveBeenCalledExactlyOnceWith(2000);
    expect(consoleError.mock.invocationCallOrder[0]).toBeLessThan(host.flush.mock.invocationCallOrder[0] as number);
    await settle();
    expect(process.exit).not.toHaveBeenCalled();

    flush.resolve(true);
    await settle();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("waits for the flush no longer than flushTimeoutMs, and exits even when the flush times out", async () => {
    const { process, emit } = aProcess();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = { ...aHost(), flush: vi.fn(async () => false) };
    installOn(process, { flushTimeoutMs: 50 }, host);

    emit("uncaughtException", new Error("boom"));
    await settle();

    expect(host.flush).toHaveBeenCalledExactlyOnceWith(50);
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("exits even when the flush rejects", async () => {
    const { process, emit } = aProcess();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = { ...aHost(), flush: vi.fn(async () => Promise.reject(new Error("transport down"))) };
    installOn(process, {}, host);

    emit("uncaughtException", new Error("boom"));
    await settle();

    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("exits at once, without a second flush, when another error arrives while the first one's flush is pending", async () => {
    const { process, emit } = aProcess();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const flush = deferred<boolean>();
    const host = { ...aHost(), flush: vi.fn(() => flush.promise) };
    installOn(process, {}, host);
    const second = new Error("second");

    emit("uncaughtException", new Error("first"));
    emit("uncaughtException", second);

    expect(host.capture).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenLastCalledWith(second);
    expect(host.flush).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("removes both listeners on teardown, and captures nothing afterwards", () => {
    const { process, emit, count } = aProcess();
    const { host, teardown } = installOn(process);

    expect(teardown).toBeTypeOf("function");
    (teardown as () => void)();
    emit("uncaughtException", new Error("boom"));
    emit("unhandledRejection", new Error("rejected"));

    expect(count("uncaughtException")).toBe(0);
    expect(count("unhandledRejection")).toBe(0);
    expect(host.capture).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });
});
