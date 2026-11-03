import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryRequest, DeliveryResponse } from "../../delivery/delivery";
import { isLoggingConfigError } from "../../logger/config-error";
import { globalHandlers, type GlobalProcess } from "../integrations/global-handlers";
import { createReporter } from "../reporter";
import { isReporterConfigError } from "../reporter-config-error";
import { createOtlpTransport, type OtlpTransportDropReason, type OtlpTransportOptions } from "./otlp-transport";

const URL_OK = "https://collector.example/v1/logs";

interface KeyValue {
  readonly key: string;
  readonly value: Record<string, unknown>;
}

function setup(overrides: Partial<OtlpTransportOptions> = {}, status = 200) {
  const time = createManualTime(1_000);
  const calls: { url: string; init: DeliveryRequest }[] = [];
  const fetch = vi.fn((url: string, init: DeliveryRequest): Promise<DeliveryResponse> => {
    calls.push({ url, init });
    return Promise.resolve(new Response(null, { status }));
  });
  const transport = createOtlpTransport({ url: URL_OK, fetch, clock: time.clock, scheduler: time.scheduler, lifecycle: {}, ...overrides });
  return { transport, calls, fetch };
}

function attributesOf(body: string): Map<string, Record<string, unknown>> {
  const record = JSON.parse(body).resourceLogs[0].scopeLogs[0].logRecords[0];
  return new Map((record.attributes as KeyValue[]).map(({ key, value }) => [key, value]));
}

function thrownBy(create: () => unknown): unknown {
  try {
    create();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Lets every pending promise reaction run. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createOtlpTransport", () => {
  it("exports a captured exception as an OTLP JSON POST carrying the exception and the event id", async () => {
    const { transport, calls } = setup();
    const reporter = createReporter((b) => b.transport(transport));

    const id = reporter.captureException(new TypeError("bad input"));
    expect(await reporter.flush()).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(URL_OK);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers["content-type"]).toBe("application/json");
    const attributes = attributesOf(calls[0]?.init.body ?? "");
    expect(attributes.get("log.record.uid")).toEqual({ stringValue: id });
    expect(attributes.get("exception.type")).toEqual({ stringValue: "TypeError" });
    expect(attributes.get("exception.message")).toEqual({ stringValue: "bad input" });
    expect(attributes.get("exception.stacktrace")?.stringValue).toMatch(/^TypeError: bad input/);
  });

  it("is drained by globalHandlers under the exit policy before the process exits", async () => {
    const { transport, fetch } = setup();
    const listeners = new Map<string, (value: unknown) => void>();
    const process = {
      on: vi.fn((event: string, listener: (value: unknown) => void) => {
        listeners.set(event, listener);
      }),
      off: vi.fn(),
      exit: vi.fn<(code: number) => unknown>(),
    } satisfies GlobalProcess;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createReporter((b) => b.transport(transport).add(globalHandlers({ onUncaught: "exit", onUnhandledRejection: "exit", process })));

    listeners.get("uncaughtException")?.(new Error("boom"));
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledOnce();
    expect(attributesOf(fetch.mock.calls[0]?.[1].body ?? "").get("exception.message")).toEqual({ stringValue: "boom" });
    expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(process.exit.mock.invocationCallOrder[0] as number);
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
    vi.restoreAllMocks();
  });

  it("ignores send after close: no export and no throw", async () => {
    const { transport, calls } = setup();
    const reporter = createReporter((b) => b.transport(transport));

    expect(await reporter.close()).toBe(true);
    expect(() => reporter.captureException(new Error("late"))).not.toThrow();
    await transport.flush();
    await settle();

    expect(calls).toHaveLength(0);
  });

  it("passes static and thunk headers through", async () => {
    const fixed = setup({ headers: { authorization: "Bearer a" } });
    createReporter((b) => b.transport(fixed.transport)).captureMessage("m");
    await fixed.transport.flush();
    expect(fixed.calls[0]?.init.headers).toMatchObject({ authorization: "Bearer a", "content-type": "application/json" });

    const thunk = setup({ headers: () => ({ "x-key": "k" }) });
    createReporter((b) => b.transport(thunk.transport)).captureMessage("m");
    await thunk.transport.flush();
    expect(thunk.calls[0]?.init.headers).toMatchObject({ "x-key": "k" });
  });

  it("forwards drops to onDrop", async () => {
    const drops: [OtlpTransportDropReason, number][] = [];
    const { transport } = setup({ onDrop: (reason, count) => drops.push([reason, count]) }, 400);

    createReporter((b) => b.transport(transport)).captureException(new Error("rejected"));
    await transport.flush();

    expect(drops).toEqual([["rejected", 1]]);
  });

  it.each([
    ["missing", undefined],
    ["relative", "/v1/logs"],
    ["not a URL", "collector"],
    ["non-http", "ftp://collector.example/logs"],
  ])("rejects a %s url with a ReporterConfigError naming createOtlpTransport", (_, url) => {
    const thrown = thrownBy(() => createOtlpTransport({ url: url as string }));

    expect(isReporterConfigError(thrown)).toBe(true);
    expect(isLoggingConfigError(thrown)).toBe(false);
    expect((thrown as Error).message).toMatch(/^createOtlpTransport expects url/);
  });

  it.each([
    { maxQueueSize: 0 },
    { maxBatchSize: 1.5 },
    { maxAttempts: -1 },
    { scheduleDelayMs: 0 },
    { attemptTimeoutMs: Number.NaN },
    { flushTimeoutMs: Number.POSITIVE_INFINITY },
  ])("rejects invalid limits %j with a ReporterConfigError naming createOtlpTransport", (limits) => {
    const thrown = thrownBy(() => createOtlpTransport({ url: URL_OK, limits }));

    expect(isReporterConfigError(thrown)).toBe(true);
    expect(isLoggingConfigError(thrown)).toBe(false);
    expect((thrown as Error).message).toMatch(new RegExp(`^createOtlpTransport expects ${Object.keys(limits)[0]}`));
  });
});
