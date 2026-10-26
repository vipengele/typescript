import type { Attributes, Level } from "@vipengele/ts-core-common";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { describe, expect, it } from "vitest";
import { isLoggingConfigError } from "./config-error";
import { Logging } from "./logging";
import type { LogRecord } from "./record";
import { createTestSink } from "./test-sink";

function aRecord(level: Level, category: string, message: string, attributes: Attributes = {}): LogRecord {
  return Object.freeze({ time: 0, level, category, message, attributes: Object.freeze({ ...attributes }) });
}

function aResource(name: string): Resource {
  return Object.freeze({
    "service.name": name,
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
}

function sinkWith(...records: LogRecord[]) {
  const sink = createTestSink();
  for (const record of records) {
    sink.write(record, aResource("svc"));
  }
  return sink;
}

describe("createTestSink", () => {
  it("records a logger's output and finds it by category and attributes", () => {
    const sink = createTestSink();
    const provider = Logging.createProvider((builder) => builder.addLevels({ "*": "info" }).addSink(sink));

    provider.logger("app.db.pool").info("connected", { host: "db1" });
    provider.logger("app.http").info("listening", { port: 8080 });

    const found = sink.find({ category: "app.db", attributes: { host: "db1" } });

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toBe("connected");
  });

  it("stores each record and its resource by reference, index-aligned, oldest first", () => {
    const sink = createTestSink();
    const first = aRecord("info", "a", "first");
    const second = aRecord("warn", "b", "second");
    const firstResource = aResource("one");
    const secondResource = aResource("two");

    sink.write(first, firstResource);
    sink.write(second, secondResource);

    expect(sink.records).toHaveLength(2);
    expect(sink.records[0]).toBe(first);
    expect(sink.records[1]).toBe(second);
    expect(sink.resources[0]).toBe(firstResource);
    expect(sink.resources[1]).toBe(secondResource);
  });

  it("clears both arrays in place, keeping their identity", () => {
    const sink = sinkWith(aRecord("info", "a", "x"), aRecord("info", "a", "y"));
    const { records, resources } = sink;

    sink.clear();

    expect(sink.records).toBe(records);
    expect(sink.resources).toBe(resources);
    expect(records).toHaveLength(0);
    expect(resources).toHaveLength(0);

    sink.write(aRecord("info", "a", "z"), aResource("svc"));
    expect(records).toHaveLength(1);
    expect(resources).toHaveLength(1);
  });

  describe("find", () => {
    it("returns a copy of every record for empty criteria, never the live array", () => {
      const sink = sinkWith(aRecord("info", "a", "x"), aRecord("debug", "b", "y"));

      const found = sink.find({});

      expect(found).toEqual(sink.records);
      expect(found).not.toBe(sink.records);
      found.length = 0;
      expect(sink.records).toHaveLength(2);
    });

    it("returns an empty array when nothing matches", () => {
      expect(sinkWith(aRecord("info", "a", "x")).find({ level: "error" })).toEqual([]);
    });

    it("matches a level exactly", () => {
      const warn = aRecord("warn", "a", "w");
      const error = aRecord("error", "a", "e");
      const sink = sinkWith(warn, error);

      expect(sink.find({ level: "warn" })).toEqual([warn]);
      expect(sink.find({ level: "error" })).toEqual([error]);
    });

    it("matches a category and every category under it at a dot boundary", () => {
      const exact = aRecord("info", "app.db", "exact");
      const child = aRecord("info", "app.db.pool", "child");
      const sibling = aRecord("info", "app.dbx", "sibling");
      const parent = aRecord("info", "app", "parent");
      const sink = sinkWith(exact, child, sibling, parent);

      expect(sink.find({ category: "app.db" })).toEqual([exact, child]);
      expect(sink.find({ category: "app" })).toEqual([exact, child, sibling, parent]);
    });

    it("matches a category case-sensitively", () => {
      const sink = sinkWith(aRecord("info", "App.db", "x"));

      expect(sink.find({ category: "app.db" })).toEqual([]);
      expect(sink.find({ category: "app" })).toEqual([]);
    });

    it.each(["*", "", "app..db", "app.*", "a:b", "a,b"])("throws a LoggingConfigError for the category %j", (category) => {
      const sink = sinkWith(aRecord("info", "app", "x"));

      expect(() => sink.find({ category })).toThrow(expect.objectContaining({ code: "observability.logger.config" }));
      try {
        sink.find({ category });
      } catch (error) {
        expect(isLoggingConfigError(error)).toBe(true);
      }
    });

    it("throws for an invalid category even with no records", () => {
      expect(() => createTestSink().find({ category: "*" })).toThrow(/Invalid logger category/);
    });

    it("matches a string message exactly", () => {
      const hit = aRecord("info", "a", "connected");
      const sink = sinkWith(hit, aRecord("info", "a", "connected to db"), aRecord("info", "a", "Connected"));

      expect(sink.find({ message: "connected" })).toEqual([hit]);
    });

    it("matches a RegExp message by test", () => {
      const first = aRecord("info", "a", "connected to db1");
      const second = aRecord("info", "a", "connected to db2");
      const sink = sinkWith(first, aRecord("info", "a", "disconnected"), second);

      expect(sink.find({ message: /^connected/ })).toEqual([first, second]);
    });

    it("finds every matching record with a g-flag RegExp", () => {
      const records = [aRecord("info", "a", "retry 1"), aRecord("info", "a", "retry 2"), aRecord("info", "a", "retry 3")];
      const sink = sinkWith(...records);
      const pattern = /retry/g;

      expect(sink.find({ message: pattern })).toEqual(records);
      expect(sink.find({ message: pattern })).toEqual(records);
    });

    it("matches attributes as a shallow subset with strict equality", () => {
      const hit = aRecord("info", "a", "x", { host: "db1", port: 5432, tls: true });
      const sink = sinkWith(hit, aRecord("info", "a", "y", { host: "db2", port: 5432 }));

      expect(sink.find({ attributes: { host: "db1" } })).toEqual([hit]);
      expect(sink.find({ attributes: { host: "db1", port: 5432 } })).toEqual([hit]);
      expect(sink.find({ attributes: { port: "5432" } })).toEqual([]);
      expect(sink.find({ attributes: { host: "db3" } })).toEqual([]);
      expect(sink.find({ attributes: {} })).toEqual(sink.records);
    });

    it("never matches an attribute key the record lacks", () => {
      const sink = sinkWith(aRecord("info", "a", "x", { host: "db1" }));

      expect(sink.find({ attributes: { host: "db1", user: null } })).toEqual([]);
    });

    it("never matches a nested object or array attribute", () => {
      const sink = sinkWith(aRecord("info", "a", "x", { db: { host: "db1" }, tags: ["a"] }));

      expect(sink.find({ attributes: { db: { host: "db1" } } })).toEqual([]);
      expect(sink.find({ attributes: { tags: ["a"] } })).toEqual([]);
    });

    it("requires every given criterion to match", () => {
      const hit = aRecord("warn", "app.db.pool", "slow query", { ms: 900 });
      const sink = sinkWith(
        hit,
        aRecord("info", "app.db.pool", "slow query", { ms: 900 }),
        aRecord("warn", "app.http", "slow query", { ms: 900 }),
        aRecord("warn", "app.db.pool", "fast query", { ms: 900 }),
        aRecord("warn", "app.db.pool", "slow query", { ms: 10 }),
      );

      expect(sink.find({ level: "warn", category: "app.db", message: /slow/, attributes: { ms: 900 } })).toEqual([hit]);
      expect(sink.find({ level: "warn", category: "app.db", message: "slow query" })).toHaveLength(2);
    });
  });
});
