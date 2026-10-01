import { afterEach, describe, expect, test, vi } from "vitest";
import { detectRuntime, type RuntimeSource, resetDetectedRuntime } from "./identity";

const nodeProcess = { versions: { node: "24.0.0" } };
const browserGlobals = { window: {}, document: {} };

afterEach(() => {
  vi.unstubAllGlobals();
  resetDetectedRuntime();
});

describe(detectRuntime.name, () => {
  test("Deno is matched by its Deno global, ahead of its Node-compatible process", () => {
    expect(detectRuntime({ Deno: {}, process: nodeProcess })).toBe("deno");
  });

  test("Bun is matched by its Bun global, ahead of its Node-compatible process", () => {
    expect(detectRuntime({ Bun: {}, process: nodeProcess })).toBe("bun");
  });

  test("Cloudflare Workers is an edge runtime, matched by its user agent ahead of nodejs_compat's process", () => {
    expect(detectRuntime({ navigator: { userAgent: "Cloudflare-Workers" }, process: nodeProcess })).toBe("edge");
  });

  test("an EdgeRuntime global marks an edge runtime", () => {
    expect(detectRuntime({ EdgeRuntime: "edge-runtime" })).toBe("edge");
  });

  test("a user agent that is not Cloudflare's does not mark an edge runtime", () => {
    expect(detectRuntime({ navigator: { userAgent: "Node.js/24" }, process: nodeProcess })).toBe("node");
  });

  test("a user agent that is not a string does not mark an edge runtime", () => {
    expect(detectRuntime({ navigator: { userAgent: 42 } })).toBe("unknown");
  });

  test("Node is matched by process.versions.node", () => {
    expect(detectRuntime({ process: nodeProcess })).toBe("node");
  });

  test("jsdom's window and document inside Node still identify Node", () => {
    expect(detectRuntime({ ...browserGlobals, process: nodeProcess })).toBe("node");
  });

  test("a process polyfill without versions.node is not Node", () => {
    expect(detectRuntime({ ...browserGlobals, process: {} })).toBe("browser");
    expect(detectRuntime({ ...browserGlobals, process: { versions: {} } })).toBe("browser");
  });

  test("a web worker is matched by WorkerGlobalScope, without a window", () => {
    expect(detectRuntime({ WorkerGlobalScope: () => undefined })).toBe("worker");
  });

  test("a browser needs both window and document", () => {
    expect(detectRuntime(browserGlobals)).toBe("browser");
    expect(detectRuntime({ window: {} })).toBe("unknown");
    expect(detectRuntime({ document: {} })).toBe("unknown");
  });

  test("a source matching nothing is unknown", () => {
    expect(detectRuntime({})).toBe("unknown");
  });

  test("an injected source is read on every call, never memoised", () => {
    const source: { -readonly [K in keyof RuntimeSource]: RuntimeSource[K] } = {};

    expect(detectRuntime(source)).toBe("unknown");

    source.Bun = {};
    expect(detectRuntime(source)).toBe("bun");
  });

  test("without a source, globalThis is read once and memoised until reset", () => {
    const first = detectRuntime();

    vi.stubGlobal("Deno", {});
    expect(detectRuntime()).toBe(first);

    resetDetectedRuntime();
    expect(detectRuntime()).toBe("deno");
  });

  test("an injected source neither reads nor fills the memo", () => {
    expect(detectRuntime({ Bun: {} })).toBe("bun");

    vi.stubGlobal("Deno", {});
    expect(detectRuntime()).toBe("deno");
  });
});
