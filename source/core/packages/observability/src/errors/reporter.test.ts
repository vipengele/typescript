import type { Level } from "@vipengele/ts-core-common";
import { describe, expect, it, vi } from "vitest";
import type { ErrorEvent, Mechanism } from "./event";
import type { Integration, IntegrationHost } from "./integration";
import { createCapture, type Pipeline } from "./pipeline";
import { createReporter } from "./reporter";
import type { Transport } from "./transport";
import { createTestTransport } from "./transports/test-transport";

const EVENT_ID = /^[0-9a-f]{32}$/;

function onlyEvent(events: readonly ErrorEvent[]): ErrorEvent {
  expect(events).toHaveLength(1);
  return events[0] as ErrorEvent;
}

/** Gives `error` a V8-shaped stack with one frame in `file`, whatever engine runs the test. */
function withStack<T extends Error>(error: T, file: string): T {
  error.stack = `${error.name}: ${error.message}\n    at run (${file}:1:2)`;
  return error;
}

function aThrowingTransport(): Transport {
  return {
    send: () => {
      throw new Error("send failed");
    },
    flush: async () => true,
    close: async () => true,
  };
}

describe("createReporter", () => {
  describe("captureException", () => {
    it("sends an event carrying the serialized error with its parsed frames, and returns its id", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));
      const error = new TypeError("bad input");

      const id = reporter.captureException(error);

      const event = onlyEvent(transport.events);
      expect(id).toMatch(EVENT_ID);
      expect(event.id).toBe(id);
      expect(event.level).toBe("error");
      expect(event.mechanism).toEqual({ handled: true, source: "capture" });
      expect(event.attributes).toEqual({});
      expect(event).not.toHaveProperty("message");
      expect(event.exception).toMatchObject({ type: "TypeError", message: "bad input" });
      expect(event.exception?.stack).toBe(error.stack);
      expect(event.exception?.frames.length).toBeGreaterThan(0);
      for (const frame of event.exception?.frames ?? []) {
        expect(frame.inApp).toEqual(expect.any(Boolean));
      }
    });

    it("marks a thrown non-Error as synthetic", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      reporter.captureException("just a string");

      expect(onlyEvent(transport.events).exception).toMatchObject({ type: "Error", message: "just a string", synthetic: true });
    });

    it("gives every link of the cause and errors chain its own frames", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));
      const root = withStack(new Error("root"), "/app/root.js");
      const first = withStack(new RangeError("first"), "/app/first.js");
      const aggregate = withStack(new AggregateError([first, 42], "several", { cause: root }), "/app/aggregate.js");
      const outer = withStack(new Error("outer", { cause: aggregate }), "/app/outer.js");

      reporter.captureException(outer);

      const exception = onlyEvent(transport.events).exception;
      expect(exception).toMatchObject({
        type: "Error",
        message: "outer",
        frames: [{ function: "run", file: "/app/outer.js", line: 1, column: 2, inApp: true }],
        cause: {
          type: "AggregateError",
          message: "several",
          frames: [{ file: "/app/aggregate.js" }],
          cause: { type: "Error", message: "root", frames: [{ file: "/app/root.js" }] },
          errors: [
            { type: "RangeError", message: "first", frames: [{ file: "/app/first.js" }] },
            { type: "Error", message: "42", synthetic: true, frames: [] },
          ],
        },
      });
      expect(exception?.cause?.cause).not.toHaveProperty("cause");
    });

    it("keeps frames in engine order with the throw site first, and the raw stack a string", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));
      const error = new Error("boom");
      error.stack = "Error: boom\n    at thrower (/app/a.js:1:2)\n    at caller (/app/b.js:3:4)";

      reporter.captureException(error);

      const exception = onlyEvent(transport.events).exception;
      expect(exception?.frames.map((frame) => frame.function)).toEqual(["thrower", "caller"]);
      expect(exception?.stack).toBe(error.stack);
    });

    it("treats every frame outside node_modules as in-app without a project root", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));
      const error = new Error("boom");
      error.stack = "Error: boom\n    at a (/srv/other/a.js:1:2)\n    at b (/app/node_modules/dep/b.js:3:4)";

      reporter.captureException(error);

      expect(onlyEvent(transport.events).exception?.frames.map((frame) => frame.inApp)).toEqual([true, false]);
    });

    it("marks only frames under the project root as in-app, on every link of the chain", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport).projectRoot("/app"));
      const cause = new Error("cause");
      cause.stack = "Error: cause\n    at c (/application/c.js:1:2)\n    at d (/app/d.js:1:2)";
      const error = new Error("boom", { cause });
      error.stack = "Error: boom\n    at a (/app/a.js:1:2)\n    at b (/srv/b.js:3:4)";

      reporter.captureException(error);

      const exception = onlyEvent(transport.events).exception;
      expect(exception?.frames.map((frame) => frame.inApp)).toEqual([true, false]);
      expect(exception?.cause?.frames.map((frame) => frame.inApp)).toEqual([false, true]);
    });

    it("matches a URL prefix project root against browser frames", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport).projectRoot("https://app.example.com/"));
      const error = new Error("boom");
      error.stack = "Error: boom\n    at a (https://app.example.com/main.js:1:2)\n    at b (https://cdn.example.com/lib.js:3:4)";

      reporter.captureException(error);

      expect(onlyEvent(transport.events).exception?.frames.map((frame) => frame.inApp)).toEqual([true, false]);
    });

    it("treats a blank project root as unset", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport).projectRoot("  "));
      const error = new Error("boom");
      error.stack = "Error: boom\n    at a (/srv/a.js:1:2)";

      reporter.captureException(error);

      expect(onlyEvent(transport.events).exception?.frames.map((frame) => frame.inApp)).toEqual([true]);
    });

    it.each([
      ["garbage", "\u0000￿ not a stack ((( @@@ :::"],
      ["a non-string", { toString: (): string => "x" }],
      ["a huge string", `Error: x\n${"    at f (/app/a.js:1:2)\n".repeat(50_000)}`],
      ["an unterminated frame", "Error: x\n    at (((("],
    ])("still delivers the event when the stack is %s", (_, stack) => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport).projectRoot("/app"));
      const error = new Error("boom");
      Object.defineProperty(error, "stack", { value: stack });

      expect(reporter.captureException(error)).toMatch(EVENT_ID);

      const exception = onlyEvent(transport.events).exception;
      expect(exception).toMatchObject({ message: "boom" });
      expect(Array.isArray(exception?.frames)).toBe(true);
    });

    it("normalizes the caller's attributes into a snapshot", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));
      const user = { id: 7, joined: new Date("2024-01-02T03:04:05.000Z"), roles: new Set(["admin"]), big: 10n };

      reporter.captureException(new Error("boom"), { attributes: { user } });
      user.id = 8;

      expect(onlyEvent(transport.events).attributes).toEqual({
        user: { id: 7, joined: "2024-01-02T03:04:05.000Z", roles: ["admin"], big: "10n" },
      });
    });

    it("uses the level the caller gives", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      reporter.captureException(new Error("going down"), { level: "fatal" });

      expect(onlyEvent(transport.events).level).toBe("fatal");
    });

    it.each([
      ["a name only Object.prototype holds", "constructor"],
      ["an unknown name", "critical"],
      ["a value that is not a string", 3],
    ])("turns %s into error", (_, level) => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      reporter.captureException(new Error("boom"), { level: level as Level });

      expect(onlyEvent(transport.events).level).toBe("error");
    });

    it("gives each capture its own id and mechanism", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      const first = reporter.captureException(new Error("one"));
      const second = reporter.captureException(new Error("two"));

      expect(first).not.toBe(second);
      const [a, b] = transport.events as [ErrorEvent, ErrorEvent];
      expect(a.mechanism).not.toBe(b.mechanism);
    });
  });

  describe("captureMessage", () => {
    it("sends an event carrying the message and no exception, at error by default", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      const id = reporter.captureMessage("disk nearly full");

      const event = onlyEvent(transport.events);
      expect(id).toMatch(EVENT_ID);
      expect(event).toEqual({
        id,
        time: expect.any(Number),
        level: "error",
        message: "disk nearly full",
        mechanism: { handled: true, source: "capture" },
        attributes: {},
      });
      expect(event).not.toHaveProperty("exception");
    });

    it("uses the level the caller gives", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      reporter.captureMessage("heads up", "warn");

      expect(onlyEvent(transport.events).level).toBe("warn");
    });

    it("turns a level that is not one into error", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));

      reporter.captureMessage("heads up", "constructor" as Level);

      expect(onlyEvent(transport.events).level).toBe("error");
    });
  });

  describe("clock", () => {
    it("stamps each event with the injected clock", () => {
      const transport = createTestTransport();
      const clock = vi.fn().mockReturnValueOnce(1000.25).mockReturnValueOnce(1000.5);
      const reporter = createReporter((b) => b.transport(transport).clock(clock));

      reporter.captureException(new Error("one"));
      reporter.captureMessage("two");

      expect(transport.events.map((event) => event.time)).toEqual([1000.25, 1000.5]);
    });

    it("defaults to epoch milliseconds", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) => b.transport(transport));
      const before = Date.now();

      reporter.captureMessage("now");

      const { time } = onlyEvent(transport.events);
      expect(time).toBeGreaterThanOrEqual(before - 1000);
      expect(time).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("drops the event and still returns an id when the clock throws", () => {
      const transport = createTestTransport();
      const reporter = createReporter((b) =>
        b.transport(transport).clock(() => {
          throw new Error("clock failed");
        }),
      );

      expect(reporter.captureException(new Error("boom"))).toMatch(EVENT_ID);
      expect(transport.events).toEqual([]);
    });
  });

  describe("transport", () => {
    it("returns an id and throws nothing with no transport and no configure", async () => {
      const reporter = createReporter();

      expect(reporter.captureException(new Error("nowhere to go"))).toMatch(EVENT_ID);
      expect(reporter.captureMessage("nowhere to go")).toMatch(EVENT_ID);
      await expect(reporter.flush()).resolves.toBe(true);
      await expect(reporter.close()).resolves.toBe(true);
    });

    it("sends only to the transport set last", () => {
      const replaced = createTestTransport();
      const current = createTestTransport();
      const reporter = createReporter((b) => b.transport(replaced).transport(current));

      reporter.captureMessage("hello");

      expect(replaced.events).toEqual([]);
      expect(current.events).toHaveLength(1);
    });

    it("drops the event silently when send throws, and still returns an id", () => {
      const reporter = createReporter((b) => b.transport(aThrowingTransport()));

      expect(reporter.captureException(new Error("boom"))).toMatch(EVENT_ID);
      expect(reporter.captureMessage("boom")).toMatch(EVENT_ID);
    });

    it("delegates flush and close, with their timeout, to the transport", async () => {
      const transport = createTestTransport();
      const flush = vi.spyOn(transport, "flush").mockResolvedValue(false);
      const close = vi.spyOn(transport, "close").mockResolvedValue(false);
      const reporter = createReporter((b) => b.transport(transport));

      await expect(reporter.flush(250)).resolves.toBe(false);
      await expect(reporter.close(500)).resolves.toBe(false);

      expect(flush).toHaveBeenCalledWith(250);
      expect(close).toHaveBeenCalledWith(500);
    });
  });

  describe("integrations", () => {
    function anIntegration(name: string, setup: Integration["setup"]): Integration {
      return { name, setup };
    }

    it("sets each integration up at creation, and its host's capture sends an event under the mechanism and level it gives", () => {
      const transport = createTestTransport();
      let host: IntegrationHost | undefined;
      createReporter((b) =>
        b.transport(transport).add(
          anIntegration("fake", (given) => {
            host = given;
          }),
        ),
      );
      const mechanism: Mechanism = { handled: false, source: "global.error" };

      const id = host?.capture(new Error("unhandled"), { mechanism, level: "fatal", attributes: { origin: "test" } });

      const event = onlyEvent(transport.events);
      expect(id).toBe(event.id);
      expect(event.level).toBe("fatal");
      expect(event.mechanism).toEqual(mechanism);
      expect(event.mechanism).not.toBe(mechanism);
      expect(event.attributes).toEqual({ origin: "test" });
      expect(event.exception).toMatchObject({ type: "Error", message: "unhandled" });
    });

    it("gives the host a flush that delegates to the transport", async () => {
      const transport = createTestTransport();
      const flush = vi.spyOn(transport, "flush").mockResolvedValue(false);
      let host: IntegrationHost | undefined;
      createReporter((b) =>
        b.transport(transport).add(
          anIntegration("fake", (given) => {
            host = given;
          }),
        ),
      );

      await expect(host?.flush(100)).resolves.toBe(false);
      expect(flush).toHaveBeenCalledWith(100);
    });

    it("runs each teardown once, before the transport closes, however often close is called", async () => {
      const order: string[] = [];
      const transport = createTestTransport();
      vi.spyOn(transport, "close").mockImplementation(async () => {
        order.push("transport");
        return true;
      });
      const reporter = createReporter((b) => b.transport(transport).add(anIntegration("fake", () => () => order.push("teardown"))));

      await reporter.close();
      await reporter.close();

      expect(order).toEqual(["teardown", "transport", "transport"]);
    });

    it("skips an integration whose setup throws, and still sets up the others", async () => {
      const teardown = vi.fn();
      const reporter = createReporter((b) =>
        b
          .add(
            anIntegration("broken", () => {
              throw new Error("setup failed");
            }),
          )
          .add(anIntegration("working", () => teardown)),
      );

      await expect(reporter.close()).resolves.toBe(true);
      expect(teardown).toHaveBeenCalledOnce();
    });

    it("installs only the integration added last under one name", () => {
      const replaced = vi.fn();
      const current = vi.fn();

      createReporter((b) => b.add(anIntegration("handlers", replaced)).add(anIntegration("handlers", current)));

      expect(replaced).not.toHaveBeenCalled();
      expect(current).toHaveBeenCalledOnce();
    });

    it("sets up one integration object once for each reporter it is added to, each against its own host", async () => {
      const hosts: IntegrationHost[] = [];
      const teardown = vi.fn();
      const shared = anIntegration("shared", (host) => {
        hosts.push(host);
        return teardown;
      });
      const first = createReporter((b) => b.add(shared));
      const second = createReporter((b) => b.add(shared));

      await first.close();

      expect(hosts).toHaveLength(2);
      expect(hosts[0]).not.toBe(hosts[1]);
      expect(teardown).toHaveBeenCalledOnce();
      await second.close();
      expect(teardown).toHaveBeenCalledTimes(2);
    });
  });
});

describe("createCapture", () => {
  function aPipeline(overrides: Partial<Pipeline> = {}): Pipeline & { transport: ReturnType<typeof createTestTransport> } {
    return { clock: () => 1, processors: [], filters: [], ...overrides, transport: createTestTransport() };
  }

  it("runs processors in order before the filters and the transport", () => {
    const seen: string[] = [];
    const pipeline = aPipeline({
      processors: [(event) => ({ ...event, message: `${event.message}+a` }), (event) => ({ ...event, message: `${event.message}+b` })],
      filters: [
        (event) => {
          seen.push(event.message as string);
          return true;
        },
      ],
    });

    createCapture(pipeline)({ kind: "message", message: "m" }, { handled: false, source: "global.error" });

    expect(seen).toEqual(["m+a+b"]);
    const event = onlyEvent(pipeline.transport.events);
    expect(event.message).toBe("m+a+b");
    expect(event.mechanism).toEqual({ handled: false, source: "global.error" });
  });

  it("does not send an event a filter drops, and runs no filter after it", () => {
    const later = vi.fn(() => true);
    const pipeline = aPipeline({ filters: [() => false, later] });

    const id = createCapture(pipeline)({ kind: "message", message: "m" }, { handled: true, source: "capture" });

    expect(id).toMatch(EVENT_ID);
    expect(later).not.toHaveBeenCalled();
    expect(pipeline.transport.events).toEqual([]);
  });

  it("drops the event and still returns an id when a processor throws", () => {
    const pipeline = aPipeline({
      processors: [
        () => {
          throw new Error("processor failed");
        },
      ],
    });

    const id = createCapture(pipeline)({ kind: "exception", error: new Error("boom") }, { handled: true, source: "capture" });

    expect(id).toMatch(EVENT_ID);
    expect(pipeline.transport.events).toEqual([]);
  });
});
