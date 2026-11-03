import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryRequest, DeliveryResponse } from "../../delivery/delivery";
import { isLoggingConfigError } from "../../logger/config-error";
import { type GlobalProcess, globalHandlers } from "../integrations/global-handlers";
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
    expect((thrown as Error).message.startsWith(`createOtlpTransport expects ${Object.keys(limits)[0]} `)).toBe(true);
  });
});

interface Row {
  id: number;
  key: string;
  body: string;
  count: number;
}

type Handler = (() => void) | null;

interface MemoryIndexedDb {
  readonly factory: IDBFactory;
  readonly rows: Row[];
  readonly opens: string[];
  readonly closed: () => number;
}

/**
 * An `IDBFactory` over an array: requests succeed on a microtask and a transaction completes on the
 * next task. With `hang`, a transaction never completes, so a write stays pending.
 */
function memoryIndexedDb(rows: Row[] = [], hang = false): MemoryIndexedDb {
  const opens: string[] = [];
  let nextId = rows.length;
  let closed = 0;
  const respond = (result: unknown) => {
    const request: { result: unknown; onsuccess: Handler } = { result: undefined, onsuccess: null };
    queueMicrotask(() => {
      request.result = result;
      request.onsuccess?.();
    });
    return request;
  };
  const database = {
    onversionchange: null as Handler,
    close: () => {
      closed += 1;
    },
    transaction: () => {
      const transaction = {
        oncomplete: null as Handler,
        onabort: null as Handler,
        objectStore: () => ({
          getAll: () => respond(rows.slice()),
          add: (row: Omit<Row, "id">) => {
            nextId += 1;
            rows.push({ ...row, id: nextId });
            return respond(undefined);
          },
          delete: (id: number) => {
            rows.splice(
              rows.findIndex((row) => row.id === id),
              1,
            );
            return respond(undefined);
          },
          index: () => ({ get: (key: string) => respond(rows.find((row) => row.key === key)) }),
        }),
      };
      if (!hang) {
        setTimeout(() => transaction.oncomplete?.(), 0);
      }
      return transaction;
    },
  };
  const factory = {
    open: (name: string) => {
      opens.push(name);
      const request: { result: unknown; onsuccess: Handler } = { result: database, onsuccess: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, rows, opens, closed: () => closed };
}

/** An `IDBFactory` whose open fails. */
function failingIndexedDb(): IDBFactory {
  return {
    open: () => {
      const request: { onerror: Handler } = { onerror: null };
      queueMicrotask(() => request.onerror?.());
      return request;
    },
  } as unknown as IDBFactory;
}

/** Lets every pending promise reaction and timer of the fakes run. */
async function idle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("resolves false from close while a save is pending and leaves the store open", async () => {
    const db = memoryIndexedDb([], true);
    const t = fixture({ limits: failing, offline: { indexedDB: db.factory } }, 503);

    t.emit();
    const closing = t.transport.close(10);
    await idle();
    await t.time.advance(10);

    expect(await closing).toBe(false);
    expect(db.closed()).toBe(0);
  });

  it.each([{ maxEntries: 0 }, { maxEntries: 1.5 }, { maxBytes: 0 }, { maxBytes: Number.NaN }])(
    "rejects offline options %o with a ReporterConfigError",
    (offline) => {
      expect(isReporterConfigError(thrownBy(() => createOtlpTransport({ url: URL_OK, offline })))).toBe(true);
    },
  );
});
