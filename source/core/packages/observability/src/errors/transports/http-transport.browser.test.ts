import type { Resource } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ErrorEvent } from "../event";
import type { Transport } from "../transport";
import { createHttpTransport } from "./http-transport";

// Browser-only: the page's real `window` and `document`, found by detection, firing real
// `pagehide` and `visibilitychange` events. The suite in both runtimes covers the drain itself
// against injected targets.

const RESOURCE: Resource = Object.freeze({
  "service.name": "checkout",
  "service.version": undefined,
  "service.dist": undefined,
  "deployment.environment.name": undefined,
  "process.runtime.name": undefined,
  "process.runtime.version": undefined,
  "os.type": undefined,
  "os.version": undefined,
  "browser.name": undefined,
  "browser.version": undefined,
  "device.type": undefined,
});

function anEvent(message: string): ErrorEvent {
  return {
    id: "0".repeat(32),
    time: 0,
    level: "error",
    message,
    mechanism: { handled: true, source: "capture" },
    attributes: {},
  };
}

const opened: Transport[] = [];

afterEach(async () => {
  Reflect.deleteProperty(globalThis.document, "visibilityState");
  await Promise.all(opened.splice(0).map((transport) => transport.close(0)));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function open() {
  const fetch = vi.fn(
    (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => Promise.resolve(new Response(null, { status: 200 })),
  );
  const transport = createHttpTransport({ url: "https://errors.example.com/ingest", fetch: fetch as typeof globalThis.fetch });
  opened.push(transport);
  return { transport, fetch };
}

/** The `message` of every event a request body carries. */
function messages(init: RequestInit | undefined): string[] {
  return (JSON.parse(String(init?.body)) as { events: ErrorEvent[] }).events.map((event) => event.message as string);
}

describe("HTTP transport unload drain in the browser", () => {
  test("sends a keepalive request on pagehide", () => {
    const { transport, fetch } = open();
    transport.send(anEvent("a"), RESOURCE);
    globalThis.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });
    expect(messages(fetch.mock.calls[0]?.[1])).toEqual(["a"]);
  });

  test("sends a keepalive request on visibilitychange to hidden, not to visible, and nothing more on the pagehide after", () => {
    const { transport, fetch } = open();
    transport.send(anEvent("a"), RESOURCE);
    Object.defineProperty(globalThis.document, "visibilityState", { configurable: true, get: () => "visible" });
    globalThis.document.dispatchEvent(new Event("visibilitychange"));
    expect(fetch).not.toHaveBeenCalled();
    Object.defineProperty(globalThis.document, "visibilityState", { configurable: true, get: () => "hidden" });
    globalThis.document.dispatchEvent(new Event("visibilitychange"));
    globalThis.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });
    expect(messages(fetch.mock.calls[0]?.[1])).toEqual(["a"]);
  });

  test("removes both listeners once closed", async () => {
    const fromWindow = vi.spyOn(globalThis, "removeEventListener");
    const fromDocument = vi.spyOn(globalThis.document, "removeEventListener");
    const { transport } = open();
    await transport.close();
    expect(fromWindow).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(fromDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
