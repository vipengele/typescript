import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryRequest, DeliveryResponse } from "../delivery/delivery";
import { failingIndexedDb, memoryIndexedDb } from "../delivery/offline/fake-indexed-db.test-support";
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
    expect(scope.logRecords[0]).toMatchObject({ severityText: "WARN", body: { stringValue: "slow query" } });
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

function fixture(overrides: Partial<OtlpLogSinkOptions> = {}, status = 200) {
  const t = setup(overrides, status);
  return { ...t, emit: () => t.provider.logger("x").info("m") };
}

function thrownBy(create: () => unknown): unknown {
  try {
    create();
  } catch (error) {
    return error;
  }
  return undefined;
}

// biome-ignore lint/security/noSecrets: a function name, flagged only for its entropy
describe("createOtlpLogSink offline", () => {
  const failing = { maxAttempts: 1 };

  it("opens no store and reports the drop as before when offline is off", async () => {
    const db = memoryIndexedDb();
    const drops: [string, number][] = [];
    const t = fixture({ limits: failing, onDrop: (reason, count) => drops.push([reason, count]) }, 503);

    t.emit();
    await t.sink.flush();

    expect(drops).toEqual([["retries-exhausted", 1]]);
    expect(db.opens).toEqual([]);
  });

  it("saves a batch the delivery gives up on under the url and kind, and reports nothing", async () => {
    const db = memoryIndexedDb();
    const drops: [string, number][] = [];
    const t = fixture({ limits: failing, offline: { indexedDB: db.factory }, onDrop: (reason, count) => drops.push([reason, count]) }, 503);

    t.emit();
    expect(await t.sink.flush()).toBe(true);

    expect(db.opens).toEqual(["vipengele-otlp-offline"]);
    expect(db.rows.map(({ key, count }) => [key, count])).toEqual([[`${URL_OK}|logs`, 1]]);
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
    await t.sink.flush();

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
    await t.sink.flush();

    expect(drops).toEqual([["retries-exhausted", 1]]);
  });

  it("drops silently when the store cannot be opened and no onDrop is given", async () => {
    const t = fixture({ limits: failing, offline: { indexedDB: failingIndexedDb() } }, 503);

    t.emit();

    expect(await t.sink.flush()).toBe(true);
  });

  it("replays a saved body at creation and deletes it on success", async () => {
    const db = memoryIndexedDb([{ id: 1, key: `${URL_OK}|logs`, body: "{}", count: 1 }]);
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
    expect(await t.sink.close()).toBe(true);

    expect(db.closed()).toBe(1);
  });

  it("uses the global IndexedDB, the detected window and the system clock when none are given", async () => {
    const t = fixture({ lifecycle: undefined, clock: undefined, scheduler: undefined, offline: true });

    expect(await t.sink.flush()).toBe(true);
  });

  it("resolves false from flush while a save is still pending", async () => {
    const db = memoryIndexedDb([], true);
    const t = fixture({ limits: { ...failing, flushTimeoutMs: 10 }, offline: { indexedDB: db.factory } }, 503);

    t.emit();
    const flushing = t.sink.flush();
    await idle();
    await t.time.advance(10);

    expect(await flushing).toBe(false);
  });

  it("resolves false from close while a save is pending and closes the store once the save completes", async () => {
    const db = heldIndexedDb();
    const t = fixture({ limits: failing, offline: { indexedDB: db.factory } }, 503);

    t.emit();
    const closing = t.sink.close(10);
    await idle();
    await t.time.advance(10);

    expect(await closing).toBe(false);
    expect(db.closed()).toBe(0);

    db.complete();
    await idle();
    expect(db.closed()).toBe(1);
  });

  it.each([{ maxEntries: 0 }, { maxEntries: 1.5 }, { maxBytes: 0 }, { maxBytes: Number.NaN }])(
    "rejects offline options %o with a LoggingConfigError",
    (offline) => {
      expect(isLoggingConfigError(thrownBy(() => createOtlpLogSink({ url: URL_OK, offline })))).toBe(true);
    },
  );
});
