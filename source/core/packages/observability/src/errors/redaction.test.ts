import { Scope } from "@vipengele/ts-core-common/scope";
import type { RedactionPolicy } from "@vipengele/ts-core-redaction";
import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "./event";
import { createCapture } from "./pipeline";
import { createReporter } from "./reporter";
import { createTestTransport, type TestTransport } from "./transports/test-transport";

const SECRET = "s3cret-value";
const REDACTED = "[REDACTED]";
const EVENT_ID = /^[0-9a-f]{32}$/;

function onlyEvent(transport: TestTransport): ErrorEvent {
  expect(transport.events).toHaveLength(1);
  return transport.events[0] as ErrorEvent;
}

function withSecretFields<T extends Error>(error: T): T {
  return Object.assign(error, { password: SECRET, reason: "quota" });
}

describe("Reporter redaction", () => {
  describe("by default, under the secretKeys preset", () => {
    it("masks a secret scope attribute, set through set or Scope.setTag", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      Scope.isolated("request", { password: SECRET }, () => {
        Scope.current().set("apiKey", SECRET);
        Scope.setTag("region", "eu");
        reporter.captureException(new Error("boom"));
      });

      expect(onlyEvent(transport).attributes).toEqual({ password: REDACTED, apiKey: REDACTED, region: "eu" });
    });

    it("masks a secret call attribute, and keeps one that is not", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      reporter.captureException(new Error("boom"), { attributes: { authorization: SECRET, orderId: 7 } });

      expect(onlyEvent(transport).attributes).toEqual({ authorization: REDACTED, orderId: 7 });
    });

    it("masks the key a Scope helper writes when any segment of it is secret", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      Scope.isolated("request", {}, () => {
        Scope.setContext("session", { id: "abc" });
        Scope.setTag("sessionId", "def");
        Scope.setContext("token", { v: 1 });
        Scope.setContext("order", { id: "o-1" });
        reporter.captureMessage("checkout failed");
      });

      expect(onlyEvent(transport).attributes).toEqual({
        "session.id": REDACTED,
        sessionId: REDACTED,
        "token.v": REDACTED,
        "order.id": "o-1",
      });
    });

    it("masks a secret in every link of a cause chain and of an AggregateError's errors", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));
      const member = withSecretFields(new Error("member"));
      const cause = withSecretFields(new AggregateError([member], "many"));
      const error = withSecretFields(new Error("outer", { cause }));

      reporter.captureException(error);

      const exception = onlyEvent(transport).exception;
      expect(exception?.data).toEqual({ password: REDACTED, reason: "quota" });
      expect(exception?.cause?.data).toEqual({ password: REDACTED, reason: "quota" });
      expect(exception?.cause?.errors?.[0]?.data).toEqual({ password: REDACTED, reason: "quota" });
    });

    it("masks a secret field of a thrown value that is not an Error, carried in its synthetic message", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      reporter.captureException({ password: SECRET, reason: "quota" });

      const exception = onlyEvent(transport).exception;
      expect(exception?.synthetic).toBe(true);
      expect(JSON.parse(exception?.message ?? "")).toEqual({ password: REDACTED, reason: "quota" });
    });

    it("leaves the event message and an Error's message, stack and frames as they are", () => {
      const transport = createTestTransport();
      const unredacted = createTestTransport();
      const error = withSecretFields(new Error(`password=${SECRET}`));
      error.stack = `Error: password=${SECRET}\n    at run (/app/token.ts:1:2)`;

      createReporter((b) => b.transport(transport)).captureException(error);
      createReporter((b) => b.transport(unredacted).redaction(null)).captureException(error);
      createReporter((b) => b.transport(transport)).captureMessage(`token=${SECRET}`);

      const [captured, message] = transport.events as [ErrorEvent, ErrorEvent];
      expect(captured.exception?.message).toBe(`password=${SECRET}`);
      expect(captured.exception?.stack).toBe(error.stack);
      expect(captured.exception?.frames).toEqual(unredacted.events[0]?.exception?.frames);
      expect(message.message).toBe(`token=${SECRET}`);
    });

    it("masks a secret in mechanism data", () => {
      const transport = createTestTransport();
      const capture = createCapture({
        clock: () => 0,
        transport,
        processors: [],
        filters: [],
        redaction: { keys: [{ segments: "token" }] },
      });

      capture({ kind: "message", message: "m" }, { handled: false, source: "network", data: { csrfToken: SECRET, status: 500 } });

      expect(onlyEvent(transport).mechanism).toEqual({ handled: false, source: "network", data: { csrfToken: REDACTED, status: 500 } });
    });
  });

  it("passes every secret through when redaction is null", () => {
    const transport = createTestTransport();
    const reporter = createReporter((b) => b.transport(transport).redaction(null));

    Scope.isolated("request", { password: SECRET }, () => {
      reporter.captureException(withSecretFields(new Error("boom")), { attributes: { token: SECRET } });
    });

    const event = onlyEvent(transport);
    expect(event.attributes).toEqual({ password: SECRET, token: SECRET });
    expect(event.exception?.data).toEqual({ password: SECRET, reason: "quota" });
  });

  it("applies a custom policy in place of the default", () => {
    const transport = createTestTransport();
    const reporter = createReporter((b) => b.transport(transport).redaction({ keys: ["region", "code"] }));
    const error = Object.assign(new Error("boom"), { code: "E_SECRET", region: "eu" });

    reporter.captureException(error, { attributes: { region: "eu", password: SECRET } });

    const event = onlyEvent(transport);
    expect(event.attributes).toEqual({ region: REDACTED, password: SECRET });
    expect(event.exception?.code).toBe(REDACTED);
    expect(event.exception?.data).toEqual({ code: REDACTED, region: REDACTED });
  });

  it("drops the event when the policy throws, and still returns its id", () => {
    const transport = createTestTransport();
    const throwing: RedactionPolicy = {
      get keys(): never {
        throw new Error("policy failed");
      },
    };
    const reporter = createReporter((b) => b.transport(transport).redaction(throwing));

    const id = reporter.captureException(new Error("boom"), { attributes: { password: SECRET } });

    expect(id).toMatch(EVENT_ID);
    expect(transport.events).toEqual([]);
  });
});
