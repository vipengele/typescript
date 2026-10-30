import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, it } from "vitest";
import type { DeliveryRequest, DeliveryResponse } from "../delivery/delivery";
import { isLoggingConfigError } from "./config-error";
import { Logging } from "./logging";
import { createOtlpLogSink, type OtlpDropReason, type OtlpLogSinkOptions } from "./otlp-sink";

const URL_OK = "https://collector.example/v1/logs";

function setup(overrides: Partial<OtlpLogSinkOptions> = {}, status = 200) {
  const time = createManualTime(1_000);
  const calls: { url: string; init: DeliveryRequest }[] = [];
  const fetch = (url: string, init: DeliveryRequest): Promise<DeliveryResponse> => {
    calls.push({ url, init });
    return Promise.resolve(new Response(null, { status }));
  };
  const sink = createOtlpLogSink({ url: URL_OK, fetch, clock: time.clock, scheduler: time.scheduler, lifecycle: {}, ...overrides });
  const provider = Logging.createProvider((b) => b.addLevels({ "*": "info" }).addSink(sink));
  return { sink, provider, calls, time };
}

// biome-ignore lint/security/noSecrets: a function name, flagged only for its entropy
describe("createOtlpLogSink", () => {
  it("exports a logged record as an OTLP JSON POST", async () => {
    const { sink, provider, calls } = setup();

    provider.logger("app.db").warn("slow query", { rows: 3 });
    expect(await sink.flush()).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(URL_OK);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(calls[0]?.init.body ?? "");
    const scope = body.resourceLogs[0].scopeLogs[0];
    expect(scope.scope.name).toBe("app.db");
    expect(scope.logRecords).toHaveLength(1);
    expect(scope.logRecords[0]).toMatchObject({ severityText: "warn", body: { stringValue: "slow query" } });
  });

  it("passes static and thunk headers through", async () => {
    const fixed = setup({ headers: { authorization: "Bearer a" } });
    fixed.provider.logger("x").info("m");
    await fixed.sink.flush();
    expect(fixed.calls[0]?.init.headers).toMatchObject({ authorization: "Bearer a", "content-type": "application/json" });

    const thunk = setup({ headers: () => ({ "x-key": "k" }) });
    thunk.provider.logger("x").info("m");
    await thunk.sink.flush();
    expect(thunk.calls[0]?.init.headers).toMatchObject({ "x-key": "k" });
  });

  it("forwards drops to onDrop", async () => {
    const drops: [OtlpDropReason, number][] = [];
    const { sink, provider } = setup({ onDrop: (reason, count) => drops.push([reason, count]) }, 400);

    provider.logger("x").info("m");
    await sink.flush();

    expect(drops).toEqual([["rejected", 1]]);
  });

  it("applies the given limits", async () => {
    const { sink, provider, calls } = setup({ limits: { maxBatchSize: 1 } });

    provider.logger("x").info("a");
    provider.logger("x").info("b");
    await sink.flush();

    expect(calls).toHaveLength(2);
  });

  it("ignores writes after close", async () => {
    const { sink, provider, calls } = setup();

    expect(await sink.close()).toBe(true);
    provider.logger("x").info("late");
    await sink.flush();

    expect(calls).toHaveLength(0);
  });

  it.each([
    ["missing", undefined],
    ["relative", "/v1/logs"],
    ["not a URL", "collector"],
    ["non-http", "ftp://collector.example/logs"],
  ])("rejects a %s url with a LoggingConfigError", (_, url) => {
    let thrown: unknown;
    try {
      createOtlpLogSink({ url: url as string });
    } catch (error) {
      thrown = error;
    }
    expect(isLoggingConfigError(thrown)).toBe(true);
  });

  it.each([
    { maxQueueSize: 0 },
    { maxBatchSize: 1.5 },
    { maxAttempts: -1 },
    { scheduleDelayMs: 0 },
    { attemptTimeoutMs: Number.NaN },
    { flushTimeoutMs: Number.POSITIVE_INFINITY },
  ])("rejects invalid limits %j with a LoggingConfigError", (limits) => {
    let thrown: unknown;
    try {
      createOtlpLogSink({ url: URL_OK, limits });
    } catch (error) {
      thrown = error;
    }
    expect(isLoggingConfigError(thrown)).toBe(true);
  });
});
