import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { describe, expect, test } from "vitest";
import { freezeDeep } from "./emit";
import { Logging } from "./logging";
import { isNormalized, markNormalized } from "./normalized";
import type { LogRecord, Sink } from "./record";
import { redactionProcessor } from "./redaction-processor";

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return freezeDeep({
    time: 1,
    level: "info",
    category: "app",
    message: "login failed for ada",
    attributes: { user: "ada", nested: { password: "p", plan: "pro" }, ssn: "123" },
    error: {
      name: "Error",
      message: "outer",
      data: { token: "t", ok: 1 },
      cause: { name: "Error", message: "inner", data: { password: "p" } },
      errors: [{ name: "Error", message: "sibling", data: { apiKey: "k" } }],
    },
    ...overrides,
  } as LogRecord);
}

const ssnPolicy: RedactionPolicy = { keys: ["ssn"] };

describe("redactionProcessor", () => {
  test("redacts nested attributes and the error chain, and leaves the message", () => {
    const out = redactionProcessor()(record()) as LogRecord;
    expect(out.message).toBe("login failed for ada");
    expect(out.attributes).toMatchObject({ user: "ada", nested: { plan: "pro" }, ssn: "123" });
    expect((out.attributes.nested as Record<string, unknown>).password).not.toBe("p");
    expect(out.error?.data).toMatchObject({ ok: 1 });
    expect(out.error?.data?.token).not.toBe("t");
    expect(out.error?.cause?.data?.password).not.toBe("p");
    expect(out.error?.errors?.[0]?.data?.apiKey).not.toBe("k");
  });

  test("defaults to secretKeys", () => {
    const input = record();
    expect(redactionProcessor()(input)).toEqual(redactionProcessor(secretKeys)(input));
  });

  test("a record without an error gets none", () => {
    const { error: _error, ...rest } = record();
    const out = redactionProcessor()(rest as LogRecord) as LogRecord;
    expect("error" in out).toBe(false);
  });

  test("a custom policy redacts a key secretKeys leaves", () => {
    const out = redactionProcessor(ssnPolicy)(record()) as LogRecord;
    expect(out.attributes.ssn).not.toBe("123");
    expect(out.attributes.user).toBe("ada");
  });

  test("returns a new record and does not mutate the input", () => {
    const input = record();
    const before = JSON.stringify(input);
    const out = redactionProcessor()(input);
    expect(out).not.toBe(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("gives one sink extra redaction while another receives the built-in result", () => {
    const strict: LogRecord[] = [];
    const plain: LogRecord[] = [];
    const sinkFor = (into: LogRecord[]): Sink => ({ write: (r) => void into.push(r) });
    const provider = Logging.createProvider((b) =>
      b
        .addLevels({ "*": "info" })
        .addSink(sinkFor(strict), { processors: [redactionProcessor(ssnPolicy)] })
        .addSink(sinkFor(plain)),
    );
    provider.logger("app").info("hi", { ssn: "123", password: "p" });
    expect(strict[0]?.attributes.ssn).not.toBe("123");
    expect(plain[0]?.attributes.ssn).toBe("123");
    expect(plain[0]?.attributes.password).not.toBe("p");
  });

  test("a marked input gives a deeply frozen, marked output", () => {
    const out = redactionProcessor()(markNormalized(record())) as LogRecord;
    expect(isNormalized(out)).toBe(true);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.attributes.nested)).toBe(true);
    expect(Object.isFrozen(out.error?.cause?.data)).toBe(true);
  });

  test("an unmarked input gives an unmarked output that is not frozen", () => {
    const out = redactionProcessor()(record()) as LogRecord;
    expect(isNormalized(out)).toBe(false);
    expect(Object.isFrozen(out)).toBe(false);
  });

  test("a sink behind it receives a frozen, JSON-safe, redacted record", () => {
    const written: LogRecord[] = [];
    const provider = Logging.createProvider((b) =>
      b.addLevels({ "*": "info" }).addSink({ write: (r) => void written.push(r) }, { processors: [redactionProcessor(ssnPolicy)] }),
    );
    provider.logger("app").error("failed", new Error("boom", { cause: { ssn: "789" } }), { ssn: "123", nested: { ssn: "456" } });
    const out = written[0] as LogRecord;
    expect(out.attributes.ssn).not.toBe("123");
    expect((out.attributes.nested as Record<string, unknown>).ssn).not.toBe("456");
    expect(out.error?.cause?.message).not.toContain("789");
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.attributes.nested)).toBe(true);
    expect(Object.isFrozen(out.error?.cause)).toBe(true);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});
