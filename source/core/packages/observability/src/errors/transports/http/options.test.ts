import { systemClock, systemScheduler } from "@vipengele/ts-core-common";
import { describe, expect, it } from "vitest";
import { isHttpTransportConfigError } from "../http-transport-config-error";
import { type HttpTransportOptions, resolveOptions } from "./options";

const url = "https://errors.example.com/ingest";

function reject(options: Record<string, unknown>): unknown {
  try {
    resolveOptions(options as unknown as HttpTransportOptions);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("resolveOptions defaults", () => {
  it("applies every default", () => {
    const resolved = resolveOptions({ url });

    expect(resolved).toEqual({
      url,
      headers: undefined,
      fetch: undefined,
      maxQueueEvents: 100,
      maxQueueBytes: 1_048_576,
      maxBatchEvents: 20,
      maxBatchBytes: 65_536,
      lingerMs: 1000,
      maxAttempts: 5,
      maxDelayMs: 30_000,
      requestTimeoutMs: 10_000,
      serialize: undefined,
      contentType: "application/json",
      onDrop: undefined,
      console: globalThis.console,
      clock: systemClock,
      scheduler: systemScheduler,
      random: Math.random,
    });
  });

  it("keeps the values it is given", () => {
    const fetchStub = (() => Promise.resolve(new Response())) as typeof fetch;
    const headers = () => ({ a: "b" });
    const serialize = () => "";
    const onDrop = () => {};
    const warn = { warn: () => {} };
    const random = () => 0.5;
    const resolved = resolveOptions({
      url: new URL("https://e.example.com/x"),
      headers,
      fetch: fetchStub,
      maxQueueEvents: 1,
      maxQueueBytes: 2,
      maxBatchEvents: 3,
      maxBatchBytes: 4,
      lingerMs: 0,
      maxAttempts: 6,
      maxDelayMs: 0,
      requestTimeoutMs: 0.5,
      serialize,
      contentType: "text/plain",
      onDrop,
      console: warn,
      random,
    });

    expect(resolved).toMatchObject({
      url: "https://e.example.com/x",
      headers,
      fetch: fetchStub,
      maxQueueEvents: 1,
      maxQueueBytes: 2,
      maxBatchEvents: 3,
      maxBatchBytes: 4,
      lingerMs: 0,
      maxAttempts: 6,
      maxDelayMs: 0,
      requestTimeoutMs: 0.5,
      serialize,
      contentType: "text/plain",
      onDrop,
      console: warn,
      random,
    });
  });

  it("accepts a requestTimeoutMs of the largest delay a timer honours", () => {
    expect(resolveOptions({ url, requestTimeoutMs: 2_147_483_647 }).requestTimeoutMs).toBe(2_147_483_647);
  });

  it("accepts a record of headers", () => {
    expect(resolveOptions({ url, headers: { a: "b" } }).headers).toEqual({ a: "b" });
  });
});

describe("resolveOptions validation", () => {
  it.each([
    ["missing", undefined],
    ["null", null],
    ["relative", "/ingest"],
    ["unparseable", "not a url"],
    ["a number", 42],
  ])("rejects a url that is %s", (_name, value) => {
    const error = reject({ url: value });

    expect(isHttpTransportConfigError(error)).toBe(true);
    expect((error as Error).message).toContain("url");
  });

  it.each(["maxQueueEvents", "maxQueueBytes", "maxBatchEvents", "maxBatchBytes", "maxAttempts"])("rejects an invalid %s", (name) => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null]) {
      const error = reject({ url, [name]: value });

      expect(isHttpTransportConfigError(error)).toBe(true);
      expect((error as Error).message).toContain(name);
    }
  });

  it.each(["lingerMs", "maxDelayMs"])("rejects an invalid %s", (name) => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "3", null]) {
      const error = reject({ url, [name]: value });

      expect(isHttpTransportConfigError(error)).toBe(true);
      expect((error as Error).message).toContain(name);
    }
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["above the largest delay a timer honours", 2_147_483_648],
    ["a string", "3"],
    ["null", null],
  ])("rejects a requestTimeoutMs that is %s", (_name, value) => {
    const error = reject({ url, requestTimeoutMs: value });

    expect(isHttpTransportConfigError(error)).toBe(true);
    expect((error as Error).message).toContain("requestTimeoutMs");
  });

  it.each(["serialize", "fetch", "onDrop", "random"])("rejects a non-function %s", (name) => {
    for (const value of ["x", 1, {}, null]) {
      const error = reject({ url, [name]: value });

      expect(isHttpTransportConfigError(error)).toBe(true);
      expect((error as Error).message).toContain(name);
    }
  });

  it.each([
    ["a string", "x"],
    ["a number", 1],
    ["null", null],
  ])("rejects headers that are %s", (_name, value) => {
    const error = reject({ url, headers: value });

    expect(isHttpTransportConfigError(error)).toBe(true);
    expect((error as Error).message).toContain("headers");
  });
});
