import type { Resource } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createDelivery, type Delivery, type DeliveryRequest, type DeliveryResponse } from "./delivery";
import { detectLifecycleTargets } from "./unload";

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

const opened: Delivery<string>[] = [];

afterEach(async () => {
  Reflect.deleteProperty(globalThis.document, "visibilityState");
  await Promise.all(opened.splice(0).map((delivery) => delivery.close(0)));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function open() {
  const fetch = vi.fn(
    (_url: string, _init: DeliveryRequest): Promise<DeliveryResponse> => Promise.resolve(new Response(null, { status: 200 })),
  );
  vi.stubGlobal("fetch", fetch);
  const delivery = createDelivery<string>({
    url: "https://collector.example/v1/logs",
    encode: (entries) => JSON.stringify(entries.map((entry) => entry.item)),
  });
  opened.push(delivery);
  return { delivery, fetch };
}

describe("unload drain in the browser", () => {
  test("detects the page's window and document", () => {
    expect(detectLifecycleTargets()).toEqual({ window: globalThis, document: globalThis.document });
  });

  test("sends a keepalive request on pagehide", () => {
    const { delivery, fetch } = open();
    delivery.enqueue("a", RESOURCE);
    globalThis.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ body: '["a"]', keepalive: true });
  });

  test("sends a keepalive request on visibilitychange to hidden, not to visible", () => {
    const { delivery, fetch } = open();
    delivery.enqueue("a", RESOURCE);
    Object.defineProperty(globalThis.document, "visibilityState", { configurable: true, get: () => "visible" });
    globalThis.document.dispatchEvent(new Event("visibilitychange"));
    expect(fetch).not.toHaveBeenCalled();
    Object.defineProperty(globalThis.document, "visibilityState", { configurable: true, get: () => "hidden" });
    globalThis.document.dispatchEvent(new Event("visibilitychange"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ body: '["a"]', keepalive: true });
  });

  test("removes both listeners once closed", async () => {
    const fromWindow = vi.spyOn(globalThis, "removeEventListener");
    const fromDocument = vi.spyOn(globalThis.document, "removeEventListener");
    const { delivery } = open();
    await delivery.close();
    expect(fromWindow).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(fromDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
