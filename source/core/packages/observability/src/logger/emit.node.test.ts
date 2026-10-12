import { Scope } from "@vipengele/ts-core-common/scope";
import { describe, expect, test } from "vitest";
import { emitRecord } from "./emit";
import type { EmitSettings, LogRecord, Sink } from "./record";

/** Yields to the macrotask queue, a boundary every carrier that survives an await must cross. */
const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("scope attributes in a record across awaits", () => {
  test("keeps each concurrent isolated scope's attributes after interleaved awaits", async () => {
    const records: LogRecord[] = [];
    const sink: Sink = {
      write(record) {
        records.push(record);
      },
    };
    const settings: EmitSettings = {
      sinks: [{ sink, processors: [] }],
      processors: [],
      clock: () => 0,
      redaction: null,
      resource: () => Scope.resource(),
      onSinkError: () => {},
    };

    const request = async (name: string): Promise<void> => {
      await Scope.isolated("request", { request: name }, async () => {
        await nextTick();
        emitRecord(settings, "info", "a", name, { step: 1 }, undefined);
        await nextTick();
        emitRecord(settings, "info", "a", name, { step: 2 }, undefined);
      });
    };

    await Promise.all([request("a"), request("b")]);

    for (const name of ["a", "b"]) {
      const own = records.filter((record) => record.message === name);
      expect(own.map((record) => record.attributes)).toEqual([
        { request: name, step: 1 },
        { request: name, step: 2 },
      ]);
    }
  });
});
