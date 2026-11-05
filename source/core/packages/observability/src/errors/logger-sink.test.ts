import { Scope } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, it } from "vitest";
import type { Logger } from "../logger/logger";
import { createLoggerProvider } from "../logger/provider";
import type { ErrorEvent } from "./event";
import type { LoggerSinkOptions } from "./logger-sink";
import { createReporter, type Reporter } from "./reporter";
import { isReporterConfigError } from "./reporter-config-error";
import type { Transport } from "./transport";
import { createTestTransport, type TestTransport } from "./transports/test-transport";

const REGISTRY_SLOT = Symbol.for("opentelemetry.js.api.1");
const SPAN_KEY = Symbol.for("OpenTelemetry Context Key SPAN");
// biome-ignore lint/security/noSecrets: the W3C Trace Context example trace id, flagged only for its entropy
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";
const otelRegistry = globalThis as unknown as Record<symbol, unknown>;

const SECRET = "s3cret-value";
const REDACTED = "[REDACTED]";

/** Registers a fake OpenTelemetry API whose active context holds a span with these ids. */
function activateSpan(): void {
  const span = { spanContext: () => ({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 }) };
  otelRegistry[REGISTRY_SLOT] = {
    context: { active: () => ({ getValue: (key: symbol) => (key === SPAN_KEY ? span : undefined) }) },
  };
}

afterEach(() => {
  delete otelRegistry[REGISTRY_SLOT];
});

function onlyEvent(events: readonly ErrorEvent[]): ErrorEvent {
  expect(events).toHaveLength(1);
  return events[0] as ErrorEvent;
}

/**
 * A reporter over `transport` and a Logger from a provider of its own, every level enabled, whose
 * one sink is the reporter's logger sink. The provider is never the realm's default one.
 */
function wire(transport: Transport, options?: LoggerSinkOptions): { reporter: Reporter; logger: Logger } {
  const reporter = createReporter((b) => b.transport(transport).dedupe(false));
  const provider = createLoggerProvider((b) => b.addLevels({ "*": "trace" }).addSink(reporter.loggerSink(options)));
  return { reporter, logger: provider.logger("app.checkout") };
}

describe("Reporter.loggerSink", () => {
  it("reports an error-level record carrying an error with its level, category, message, scope attributes and trace", () => {
    activateSpan();
    const transport = createTestTransport();
    const { logger } = wire(transport);

    Scope.isolated("request", { requestId: "r-1" }, () => {
      logger.error("payment failed", new Error("card declined"), { orderId: 7 });
    });

    const event = onlyEvent(transport.events);
    expect(event.mechanism).toEqual({ handled: true, source: "logger" });
    expect(event.level).toBe("error");
    expect(event.exception?.message).toBe("card declined");
    expect(event.attributes).toEqual({
      requestId: "r-1",
      orderId: 7,
      "logger.category": "app.checkout",
      "logger.message": "payment failed",
    });
    expect(event.trace).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, flags: 1 });
  });

  it("reports a fatal record carrying an error at its own level", () => {
    const transport = createTestTransport();
    const { logger } = wire(transport);

    logger.fatal("going down", new Error("disk full"));

    expect(onlyEvent(transport.events).level).toBe("fatal");
  });

  it("ignores an error-level record without an error", () => {
    const transport = createTestTransport();
    const { logger } = wire(transport);

    logger.error("payment failed");

    expect(transport.events).toEqual([]);
  });

  it("ignores a record carrying an error below the minimum level", () => {
    const transport = createTestTransport();
    const { logger } = wire(transport);

    logger.warn("retrying", new Error("timeout"));

    expect(transport.events).toEqual([]);
  });

  it("reports a warn record carrying an error when the minimum level is warn", () => {
    const transport = createTestTransport();
    const { logger } = wire(transport, { minLevel: "warn" });

    logger.warn("retrying", new Error("timeout"));
    logger.info("still going", undefined);

    expect(onlyEvent(transport.events).level).toBe("warn");
  });

  it.each(["loud", "off", null, 5])("throws a ReporterConfigError for the minimum level %s", (value) => {
    const reporter = createReporter();

    expect(() => reporter.loggerSink({ minLevel: value as never })).toThrow(expect.toSatisfy(isReporterConfigError));
  });

  it("names the invalid minimum level in the error message", () => {
    const reporter = createReporter();

    expect(() => reporter.loggerSink({ minLevel: "loud" as never })).toThrow(
      'Invalid reporter logger sink minimum level "loud": expected a level.',
    );
    expect(() => reporter.loggerSink({ minLevel: null as never })).toThrow(
      "Invalid reporter logger sink minimum level of type null: expected a level.",
    );
    expect(() => reporter.loggerSink({ minLevel: 5 as never })).toThrow(
      "Invalid reporter logger sink minimum level of type number: expected a level.",
    );
  });

  it("drops a record its own transport logs back through the same logger, sending exactly one event", () => {
    const inner = createTestTransport();
    let logger: Logger | undefined;
    const transport: Transport = {
      send(event, resource) {
        logger?.error("delivery failed", new Error("socket closed"));
        inner.send(event, resource);
      },
      flush: (timeoutMs) => inner.flush(timeoutMs),
      close: (timeoutMs) => inner.close(timeoutMs),
    };
    logger = wire(transport).logger;

    logger.error("payment failed", new Error("card declined"));

    expect(onlyEvent(inner.events).exception?.message).toBe("card declined");
  });

  it("reports again once its own capture has returned", () => {
    const transport = createTestTransport();
    const { logger } = wire(transport);

    logger.error("first", new Error("one"));
    logger.error("second", new Error("two"));

    expect(transport.events.map((event) => event.exception?.message)).toEqual(["one", "two"]);
  });

  it("matches captureException after the reporter is closed", async () => {
    const transport: TestTransport = createTestTransport();
    const { reporter, logger } = wire(transport);
    await reporter.close();

    const id = reporter.captureException(new Error("captured"));
    const afterCapture = [...transport.events];
    expect(() => logger.error("logged", new Error("logged"))).not.toThrow();

    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(transport.events).toEqual(afterCapture);
    expect(transport.events).toEqual([]);
  });

  it("keeps a secret attribute and a secret error field redacted all the way to the transport", () => {
    const transport = createTestTransport();
    const { logger } = wire(transport);

    logger.error("login failed", Object.assign(new Error("denied"), { password: SECRET }), { password: SECRET, user: "ada" });

    const event = onlyEvent(transport.events);
    expect(event.attributes.password).toBe(REDACTED);
    expect(event.attributes.user).toBe("ada");
    expect(event.exception?.data).toEqual({ password: REDACTED });
    expect(JSON.stringify(event)).not.toContain(SECRET);
  });
});
