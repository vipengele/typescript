import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationHost } from "../integration";
import { type GlobalEventTarget, type GlobalHandlersOptions, globalHandlers } from "./global-handlers";

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

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("installs nothing when no event target is given and globalThis has no addEventListener", () => {
    vi.stubGlobal("addEventListener", undefined);

    expect(globalHandlers(exitPolicies).setup(aHost())).toBeUndefined();
  });
});
