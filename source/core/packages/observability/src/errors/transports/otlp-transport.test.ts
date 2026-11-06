import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryRequest, DeliveryResponse } from "../../delivery/delivery";
import { failingIndexedDb, memoryIndexedDb } from "../../delivery/offline/fake-indexed-db.test-support";
import { isLoggingConfigError } from "../../logger/config-error";
import { type GlobalProcess, globalHandlers } from "../integrations/global-handlers";
import { createReporter } from "../reporter";
import { isReporterConfigError } from "../reporter-config-error";
import { createOtlpTransport, type OtlpTransportDropReason, type OtlpTransportOptions } from "./otlp-transport";

// biome-ignore lint/security/noSecrets: the W3C Trace Context example trace id, flagged only for its entropy
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

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

function firstRecord(body: string): Record<string, unknown> {
  return JSON.parse(body).resourceLogs[0].scopeLogs[0].logRecords[0];
}

/** Runs `fn` with a fake OpenTelemetry registry whose active span is TRACE_ID/SPAN_ID, removed even when `fn` throws. */
async function withActiveSpan(fn: () => Promise<void>): Promise<void> {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  const slot = Symbol.for("opentelemetry.js.api.1");
  const span = { spanContext: () => ({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 }) };
  registry[slot] = {
    context: { active: () => ({ getValue: (key: symbol) => (key === Symbol.for("OpenTelemetry Context Key SPAN") ? span : undefined) }) },
  };
  try {
    await fn();
  } finally {
    delete registry[slot];
  }
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

  it("exports an exception inside an active span as an exception record carrying the span", async () => {
    await withActiveSpan(async () => {
      const { transport, calls } = setup();
      const reporter = createReporter((b) => b.transport(transport));

      reporter.captureException(new Error("boom"));
      await reporter.flush();

      const record = firstRecord(calls[0]?.init.body ?? "");
      expect(record.eventName).toBe("exception");
      expect(record.severityNumber).toBe(17);
      expect(record.severityText).toBe("ERROR");
      const keys = (record.attributes as KeyValue[]).map(({ key }) => key);
      expect(keys).toEqual(expect.arrayContaining(["exception.type", "exception.message", "exception.stacktrace"]));
      expect(record.traceId).toBe(TRACE_ID);
      expect(record.spanId).toBe(SPAN_ID);
      expect(record.flags).toBe(1);
    });
  });

  it("exports a fatal message with no active span without an eventName or trace", async () => {
    const { transport, calls } = setup();
    const reporter = createReporter((b) => b.transport(transport));

    reporter.captureMessage("out of memory", "fatal");
    await reporter.flush();

    const record = firstRecord(calls[0]?.init.body ?? "");
    expect(record.severityNumber).toBe(21);
    expect(record.severityText).toBe("FATAL");
    expect(record).not.toHaveProperty("eventName");
    expect(record).not.toHaveProperty("traceId");
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
    expect((thrown as Error).message.startsWith(`createOtlpTransport expects ${Object.keys(limits)[0]} `)).toBe(true);
  });
});

/** Lets every pending promise reaction and timer of the fakes run. */
async function idle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A hanging `memoryIndexedDb` whose transactions started so far complete on `complete()`. */
function heldIndexedDb() {
  const db = memoryIndexedDb([], true);
  const started: IDBTransaction[] = [];
  const factory = {
    open: (name: string) => {
      const request = db.factory.open(name);
      const database = request.result;
      const transaction = database.transaction.bind(database);
      database.transaction = ((...args: Parameters<IDBDatabase["transaction"]>) => {
        const begun = transaction(...args);
        started.push(begun);
        return begun;
      }) as IDBDatabase["transaction"];
      return request;
    },
  } as unknown as IDBFactory;
  const complete = () => {
    for (const begun of started.splice(0)) {
      begun.oncomplete?.(new Event("complete"));
    }
  };
  return { factory, closed: db.closed, complete };
}

function fixture(overrides: Partial<OtlpTransportOptions> = {}, status = 200) {
  const time = createManualTime(1_000);
  const calls: { url: string; init: DeliveryRequest }[] = [];
  const fetch = (url: string, init: DeliveryRequest): Promise<DeliveryResponse> => {
    calls.push({ url, init });
    return Promise.resolve(new Response(null, { status }));
  };
  const transport = createOtlpTransport({ url: URL_OK, fetch, clock: time.clock, scheduler: time.scheduler, lifecycle: {}, ...overrides });
  const reporter = createReporter((b) => b.transport(transport).dedupe(false));
  return { transport, calls, time, emit: () => reporter.captureException(new Error("m")) };
}

describe("createOtlpTransport offline", () => {
  const failing = { maxAttempts: 1 };

  it("opens no store and reports the drop as before when offline is off", async () => {
    const db = memoryIndexedDb();
    const drops: [string, number][] = [];
    const t = fixture({ limits: failing, onDrop: (reason, count) => drops.push([reason, count]) }, 503);

    t.emit();
    await t.transport.flush();

    expect(drops).toEqual([["retries-exhausted", 1]]);
    expect(db.opens).toEqual([]);
  });

  it("saves a batch the delivery gives up on under the url and kind, and reports nothing", async () => {
    const db = memoryIndexedDb();
    const drops: [string, number][] = [];
    const t = fixture({ limits: failing, offline: { indexedDB: db.factory }, onDrop: (reason, count) => drops.push([reason, count]) }, 503);

    t.emit();
    expect(await t.transport.flush()).toBe(true);

    expect(db.opens).toEqual(["vipengele-otlp-offline"]);
    expect(db.rows.map(({ key, count }) => [key, count])).toEqual([[`${URL_OK}|errors`, 1]]);
    expect(JSON.parse(db.rows[0]?.body ?? "")).toHaveProperty("resourceLogs");
    expect(drops).toEqual([]);
  });

  it("reports a batch past the bounds as offline-full", async () => {
    const db = memoryIndexedDb();
    const drops: [string, number][] = [];
    const t = fixture(
      {
        limits: { ...failing, maxBatchSize: 1 },
        offline: { indexedDB: db.factory, maxEntries: 1 },
        onDrop: (reason, count) => drops.push([reason, count]),
      },
      503,
    );

    t.emit();
    t.emit();
    await t.transport.flush();

    expect(db.rows).toHaveLength(1);
    expect(drops).toEqual([["offline-full", 1]]);
  });

  it("reports the delivery's reason when the store cannot be opened", async () => {
    const drops: [string, number][] = [];
    const t = fixture(
      { limits: failing, offline: { indexedDB: failingIndexedDb() }, onDrop: (reason, count) => drops.push([reason, count]) },
      503,
    );

    t.emit();
    await t.transport.flush();

    expect(drops).toEqual([["retries-exhausted", 1]]);
  });

  it("drops silently when the store cannot be opened and no onDrop is given", async () => {
    const t = fixture({ limits: failing, offline: { indexedDB: failingIndexedDb() } }, 503);

    t.emit();

    expect(await t.transport.flush()).toBe(true);
  });

  it("replays a saved body at creation and deletes it on success", async () => {
    const db = memoryIndexedDb([{ id: 1, key: `${URL_OK}|errors`, body: "{}", count: 1 }]);
    const t = fixture({ offline: { indexedDB: db.factory } });

    await vi.waitFor(() => expect(db.rows).toHaveLength(0));

    expect(t.calls.map(({ init }) => init.body)).toEqual(["{}"]);
  });

  it("replays only its own kind", async () => {
    const db = memoryIndexedDb([{ id: 1, key: `${URL_OK}|other`, body: "{}", count: 1 }]);
    const t = fixture({ offline: { indexedDB: db.factory } });

    await idle();

    expect(t.calls).toEqual([]);
    expect(db.rows).toHaveLength(1);
  });

  it("closes the store once close has settled the saves", async () => {
    const db = memoryIndexedDb();
    const t = fixture({ limits: failing, offline: { indexedDB: db.factory } }, 503);

    t.emit();
    expect(await t.transport.close()).toBe(true);

    expect(db.closed()).toBe(1);
  });

  it("uses the global IndexedDB, the detected window and the system clock when none are given", async () => {
    const t = fixture({ lifecycle: undefined, clock: undefined, scheduler: undefined, offline: true });

    expect(await t.transport.flush()).toBe(true);
  });

  it("resolves false from flush while a save is still pending", async () => {
    const db = memoryIndexedDb([], true);
    const t = fixture({ limits: { ...failing, flushTimeoutMs: 10 }, offline: { indexedDB: db.factory } }, 503);

    t.emit();
    const flushing = t.transport.flush();
    await idle();
    await t.time.advance(10);

    expect(await flushing).toBe(false);
  });

  it("resolves false from close while a save is pending and closes the store once the save completes", async () => {
    const db = heldIndexedDb();
    const t = fixture({ limits: failing, offline: { indexedDB: db.factory } }, 503);

    t.emit();
    const closing = t.transport.close(10);
    await idle();
    await t.time.advance(10);

    expect(await closing).toBe(false);
    expect(db.closed()).toBe(0);

    db.complete();
    await idle();
    expect(db.closed()).toBe(1);
  });

  it.each([{ maxEntries: 0 }, { maxEntries: 1.5 }, { maxBytes: 0 }, { maxBytes: Number.NaN }])(
    "rejects offline options %o with a ReporterConfigError",
    (offline) => {
      expect(isReporterConfigError(thrownBy(() => createOtlpTransport({ url: URL_OK, offline })))).toBe(true);
    },
  );
});
