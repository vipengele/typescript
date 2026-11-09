// biome-ignore-all lint/security/noSecrets: every fixture is a URL, flagged only for its entropy
import { breadcrumbs, Scope } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { afterEach, describe, expect, test } from "vitest";
import { suppressBreadcrumbs } from "../../../breadcrumb-suppression";
import { installXhr, XHR_NETWORK_ERROR, type XhrInstrumentationOptions, type XhrTarget } from "./xhr";

const uninstalls: (() => void)[] = [];

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) {
    uninstall();
  }
});

type Listener = () => void;

/**
 * A stand-in `XMLHttpRequest` class, fresh per test so a patch never outlives its test. `send`
 * throws unless the instance is opened and not yet sent, as the real one does, and `end` fires
 * `loadend` with a status.
 */
function fakeXhrClass() {
  const calls: { method: string; self: unknown; args: unknown[] }[] = [];
  class FakeXhr {
    status: unknown = 0;
    state: "unsent" | "opened" | "sent" = "unsent";
    readonly listeners = new Set<Listener>();

    open(...args: unknown[]): string {
      calls.push({ method: "open", self: this, args });
      if (args[0] === "BAD") {
        throw new SyntaxError("bad method");
      }
      this.state = "opened";
      return "opened";
    }

    send(...args: unknown[]): string {
      calls.push({ method: "send", self: this, args });
      if (this.state !== "opened") {
        throw new Error("InvalidStateError");
      }
      this.state = "sent";
      return "sent";
    }

    addEventListener(type: string, listener: Listener): void {
      if (type === "loadend") {
        this.listeners.add(listener);
      }
    }

    removeEventListener(type: string, listener: Listener): void {
      if (type === "loadend") {
        this.listeners.delete(listener);
      }
    }

    end(status: unknown): void {
      this.status = status;
      for (const listener of [...this.listeners]) {
        listener();
      }
    }
  }
  return { FakeXhr, calls, target: { XMLHttpRequest: FakeXhr } satisfies XhrTarget };
}

function installed(options: XhrInstrumentationOptions, target: XhrTarget): () => void {
  const uninstall = installXhr(options, target);
  uninstalls.push(uninstall);
  return uninstall;
}

/** Runs `fn` in a fresh Unit of Work and returns the trail it left once `fn` settled. */
function trailOf(fn: () => unknown) {
  return Scope.isolated("test", {}, async () => {
    const scope = Scope.current();
    await fn();
    return breadcrumbs(scope);
  });
}

describe("installXhr", () => {
  test("records one crumb at loadend with method, redacted URL, status and duration", async () => {
    const time = createManualTime(5_000);
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: time.clock, redaction: secretKeys }, target);

    const trail = await trailOf(async () => {
      const xhr = new FakeXhr();
      xhr.open("get", "https://api.example.com/items?token=abc&page=2");
      xhr.send();
      await time.advance(40);
      xhr.end(200);
    });

    expect(trail).toEqual([
      {
        time: 5_040,
        category: "http",
        level: "info",
        message: "GET https://api.example.com/items?token=[REDACTED]&page=2",
        data: {
          method: "GET",
          url: "https://api.example.com/items?token=[REDACTED]&page=2",
          status_code: 200,
          duration_ms: 40,
        },
      },
    ]);
  });

  test("calls the originals with the same this and arguments and returns what they return", () => {
    const { FakeXhr, calls, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();

    expect(xhr.open("POST", "/a", true)).toBe("opened");
    expect(xhr.send("body")).toBe("sent");

    expect(calls).toEqual([
      { method: "open", self: xhr, args: ["POST", "/a", true] },
      { method: "send", self: xhr, args: ["body"] },
    ]);
  });

  test("reads a URL argument through its string form", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);

    const [crumb] = await trailOf(() => {
      const xhr = new FakeXhr();
      xhr.open("GET", new URL("https://example.com/u?api_key=k"));
      xhr.send();
      xhr.end(200);
    });

    expect(crumb?.message).toBe("GET https://example.com/u?api_key=[REDACTED]");
  });

  test.each([
    [200, "info"],
    [399, "info"],
    [400, "warn"],
    [499, "warn"],
    [500, "error"],
    [503, "error"],
  ])("a status of %i records at %s", async (status, level) => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);

    const [crumb] = await trailOf(() => {
      const xhr = new FakeXhr();
      xhr.open("GET", "/x");
      xhr.send();
      xhr.end(status);
    });

    expect(crumb?.level).toBe(level);
    expect(crumb?.data?.status_code).toBe(status);
  });

  test("a status of 0 records a network error at error without status_code", async () => {
    const time = createManualTime(0);
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: time.clock, redaction: secretKeys }, target);

    const trail = await trailOf(async () => {
      const xhr = new FakeXhr();
      xhr.open("delete", "/x");
      xhr.send();
      await time.advance(7);
      xhr.end(0);
    });

    expect(trail).toEqual([
      {
        time: 7,
        category: "http",
        level: "error",
        message: "DELETE /x",
        data: { method: "DELETE", url: "/x", duration_ms: 7, error: XHR_NETWORK_ERROR },
      },
    ]);
    expect(XHR_NETWORK_ERROR).toBe("NetworkError");
  });

  test("a status that is not a number, or whose read throws, records at info without status_code", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);

    const trail = await trailOf(() => {
      const plain = new FakeXhr();
      plain.open("GET", "/a");
      plain.send();
      plain.end("200");
      const hostile = new FakeXhr();
      hostile.open("GET", "/b");
      hostile.send();
      Object.defineProperty(hostile, "status", {
        get(): number {
          throw new Error("no status");
        },
      });
      for (const listener of [...hostile.listeners]) {
        listener();
      }
    });

    expect(trail.map((crumb) => [crumb.level, crumb.data])).toEqual([
      ["info", { method: "GET", url: "/a", duration_ms: 0 }],
      ["info", { method: "GET", url: "/b", duration_ms: 0 }],
    ]);
  });

  test("redacts with the install's policy", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    const policy: RedactionPolicy = { keys: ["page"] };
    installed({ clock: () => 0, redaction: policy }, target);

    const [crumb] = await trailOf(() => {
      const xhr = new FakeXhr();
      xhr.open("GET", "/x?token=t&page=2");
      xhr.send();
      xhr.end(200);
    });

    expect(crumb?.data?.url).toBe("/x?token=t&page=[REDACTED]");
  });

  test("defaults a missing clock and redaction, as another copy's entry may have", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({} as XhrInstrumentationOptions, target);
    const before = Date.now();

    const [crumb] = await trailOf(() => {
      const xhr = new FakeXhr();
      xhr.open("GET", "/x?token=t");
      xhr.send();
      xhr.end(200);
    });

    expect(crumb?.time).toBeGreaterThanOrEqual(before);
    expect(crumb?.data?.url).toBe("/x?token=[REDACTED]");
  });

  test("a request sent while suppressed records nothing when it ends", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);

    const trail = await trailOf(() => {
      const xhr = new FakeXhr();
      xhr.open("GET", "/internal");
      suppressBreadcrumbs(() => xhr.send());
      xhr.end(200);
    });

    expect(trail).toEqual([]);
  });

  test("a request opened while suppressed and sent outside it records", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);

    const trail = await trailOf(() => {
      const xhr = new FakeXhr();
      suppressBreadcrumbs(() => xhr.open("GET", "/x"));
      xhr.send();
      xhr.end(200);
    });

    expect(trail.map((crumb) => crumb.message)).toEqual(["GET /x"]);
  });

  test("records into the Unit of Work that sent the request", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();

    const sender = Scope.isolated("sender", {}, () => {
      xhr.open("GET", "/x");
      xhr.send();
      return Scope.current();
    });
    const ender = await trailOf(() => xhr.end(200));

    expect(breadcrumbs(sender).map((crumb) => crumb.message)).toEqual(["GET /x"]);
    expect(ender).toEqual([]);
  });

  test("a request ending after every install is torn down records with its send-time options", async () => {
    const time = createManualTime(100);
    const { FakeXhr, target } = fakeXhrClass();
    const uninstall = installed({ clock: time.clock, redaction: { keys: ["page"] } }, target);
    const wrapper = FakeXhr.prototype.send;

    const trail = await trailOf(async () => {
      const xhr = new FakeXhr();
      xhr.open("GET", "/x?page=2");
      xhr.send();
      uninstall();
      await time.advance(3);
      xhr.end(200);
    });

    expect(FakeXhr.prototype.send).not.toBe(wrapper);
    expect(trail).toEqual([
      {
        time: 103,
        category: "http",
        level: "info",
        message: "GET /x?page=[REDACTED]",
        data: { method: "GET", url: "/x?page=[REDACTED]", status_code: 200, duration_ms: 3 },
      },
    ]);
  });

  test("the loadend listener removes itself when it fires", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();

    const trail = await trailOf(() => {
      xhr.open("GET", "/x");
      xhr.send();
      expect(xhr.listeners.size).toBe(1);
      xhr.end(200);
      xhr.end(200);
    });

    expect(xhr.listeners.size).toBe(0);
    expect(trail).toHaveLength(1);
  });

  test("a listener that cannot be removed records at most once", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();
    xhr.removeEventListener = () => {
      throw new Error("cannot remove");
    };

    const trail = await trailOf(() => {
      xhr.open("GET", "/x");
      xhr.send();
      xhr.end(200);
      xhr.end(500);
    });

    expect(trail.map((crumb) => crumb.data?.status_code)).toEqual([200]);
  });

  test("an instance re-opened and re-sent records each request once", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();

    const trail = await trailOf(() => {
      xhr.open("GET", "/first");
      xhr.send();
      xhr.end(200);
      xhr.open("POST", "/second");
      xhr.send();
      xhr.end(201);
    });

    expect(trail.map((crumb) => crumb.message)).toEqual(["GET /first", "POST /second"]);
    expect(xhr.listeners.size).toBe(0);
  });

  test("re-opening an instance mid-request drops that request's crumb", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();

    const trail = await trailOf(() => {
      xhr.open("GET", "/abandoned");
      xhr.send();
      xhr.open("GET", "/kept");
      xhr.send();
      xhr.end(200);
    });

    expect(trail.map((crumb) => crumb.message)).toEqual(["GET /kept"]);
    expect(xhr.listeners.size).toBe(0);
  });

  test("a send that throws propagates, removes its listener and leaves the request in flight recording once", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();

    const trail = await trailOf(() => {
      xhr.open("GET", "/x");
      xhr.send();
      expect(() => xhr.send()).toThrow("InvalidStateError");
      expect(xhr.listeners.size).toBe(1);
      xhr.end(200);
    });

    expect(trail).toHaveLength(1);
  });

  test("a send that throws with a listener that cannot be removed still propagates", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();
    xhr.removeEventListener = () => {
      throw new Error("cannot remove");
    };

    await trailOf(() => {
      xhr.open("GET", "/x");
      xhr.send();
      expect(() => xhr.send()).toThrow("InvalidStateError");
    });
  });

  test("an open that throws propagates and leaves no request to record", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();

    const trail = await trailOf(() => {
      expect(() => xhr.open("BAD", "/x")).toThrow(SyntaxError);
      xhr.state = "opened";
      xhr.send();
      xhr.end(200);
    });

    expect(trail).toEqual([]);
  });

  test("a send on an instance never opened through the wrapper records nothing", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();

    const trail = await trailOf(() => {
      xhr.state = "opened";
      xhr.send();
      xhr.end(200);
    });

    expect(trail).toEqual([]);
    expect(xhr.listeners.size).toBe(0);
  });

  test("open arguments that cannot be read leave no request to record", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();
    const unprintable = {
      toString(): string {
        throw new Error("no string");
      },
    };

    const trail = await trailOf(() => {
      xhr.open("GET", "/earlier");
      xhr.open("GET", unprintable);
      xhr.send();
      xhr.end(200);
    });

    expect(trail).toEqual([]);
  });

  test("an instance whose listener cannot be added sends unrecorded", async () => {
    const { FakeXhr, calls, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const xhr = new FakeXhr();
    xhr.addEventListener = () => {
      throw new Error("cannot listen");
    };

    const trail = await trailOf(() => {
      xhr.open("GET", "/x");
      expect(xhr.send()).toBe("sent");
    });

    expect(trail).toEqual([]);
    expect(calls.map((call) => call.method)).toEqual(["open", "send"]);
  });

  test("a clock that throws at send or at loadend drops the crumb and keeps the request", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    let reads = 0;
    let failAt = 1;
    const clock = () => {
      reads += 1;
      if (reads === failAt) {
        throw new Error("clock failed");
      }
      return 0;
    };
    installed({ clock, redaction: secretKeys }, target);

    const trail = await trailOf(() => {
      const atSend = new FakeXhr();
      atSend.open("GET", "/a");
      expect(atSend.send()).toBe("sent");
      atSend.end(200);
      failAt = 3;
      const atEnd = new FakeXhr();
      atEnd.open("GET", "/b");
      atEnd.send();
      atEnd.end(200);
    });

    expect(trail).toEqual([]);
  });

  test("a send called on a value that is not an object goes to the original unrecorded", () => {
    const { FakeXhr, calls, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);

    expect(() => FakeXhr.prototype.open.call(undefined as unknown as InstanceType<typeof FakeXhr>, "GET", "/x")).toThrow(TypeError);
    expect(() => FakeXhr.prototype.send.call(undefined as unknown as InstanceType<typeof FakeXhr>)).toThrow(TypeError);
    expect(calls.map((call) => call.method)).toEqual(["open", "send"]);
  });

  test("restores the originals when the last install leaves", () => {
    const { FakeXhr, target } = fakeXhrClass();
    const { open, send } = FakeXhr.prototype;
    const uninstall = installXhr({ clock: () => 0, redaction: secretKeys }, target);

    expect(FakeXhr.prototype.open).not.toBe(open);
    expect(FakeXhr.prototype.send).not.toBe(send);
    uninstall();

    expect(FakeXhr.prototype.open).toBe(open);
    expect(FakeXhr.prototype.send).toBe(send);
  });

  test("a second install adds no second wrapper and records each request once", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    installed({ clock: () => 0, redaction: secretKeys }, target);
    const wrapper = FakeXhr.prototype.send;
    installed({ clock: () => 1, redaction: secretKeys }, target);

    const trail = await trailOf(() => {
      const xhr = new FakeXhr();
      xhr.open("GET", "/x");
      xhr.send();
      xhr.end(200);
    });

    expect(FakeXhr.prototype.send).toBe(wrapper);
    expect(trail.map((crumb) => crumb.time)).toEqual([0]);
  });

  test("a wrapper left under another party's wrapper passes through without recording", async () => {
    const { FakeXhr, calls, target } = fakeXhrClass();
    const uninstall = installXhr({ clock: () => 0, redaction: secretKeys }, target);
    const ours = FakeXhr.prototype.send;
    FakeXhr.prototype.send = function (this: InstanceType<typeof FakeXhr>, ...args: unknown[]) {
      return ours.apply(this, args);
    };
    uninstall();

    const trail = await trailOf(() => {
      const xhr = new FakeXhr();
      xhr.open("GET", "/x");
      xhr.send();
      xhr.end(200);
    });

    expect(trail).toEqual([]);
    expect(calls.map((call) => call.method)).toEqual(["open", "send"]);
  });

  test("a prototype method whose assignment throws is skipped while the other patches", async () => {
    const { FakeXhr, target } = fakeXhrClass();
    const send = FakeXhr.prototype.send;
    Object.defineProperty(FakeXhr.prototype, "open", { value: FakeXhr.prototype.open, writable: false, configurable: true });
    const uninstall = installed({ clock: () => 0, redaction: secretKeys }, target);

    expect(FakeXhr.prototype.send).not.toBe(send);
    const trail = await trailOf(() => {
      const xhr = new FakeXhr();
      xhr.open("GET", "/x");
      xhr.send();
      xhr.end(200);
    });
    uninstall();

    expect(trail).toEqual([]);
    expect(FakeXhr.prototype.send).toBe(send);
  });

  test("a prototype whose every assignment fails installs nothing", () => {
    const { FakeXhr, target } = fakeXhrClass();
    Object.freeze(FakeXhr.prototype);

    const uninstall = installed({ clock: () => 0, redaction: secretKeys }, target);

    expect(() => uninstall()).not.toThrow();
  });

  test.each([
    ["no XMLHttpRequest", {}],
    ["a non-function XMLHttpRequest", { XMLHttpRequest: {} }],
    ["a constructor with no prototype object", { XMLHttpRequest: Object.assign(() => {}, { prototype: undefined }) }],
    ["a target that is not an object", null],
    [
      "an XMLHttpRequest whose read throws",
      Object.defineProperty({}, "XMLHttpRequest", {
        get(): unknown {
          throw new Error("no constructor");
        },
      }),
    ],
  ])("installs nothing on %s", (_name, target) => {
    const uninstall = installXhr({ clock: () => 0, redaction: secretKeys }, target as XhrTarget);

    expect(() => uninstall()).not.toThrow();
  });

  test("defaults to the realm's XMLHttpRequest, installing nothing where the runtime has none", () => {
    const realm = globalThis as XhrTarget;
    const prototype = (realm.XMLHttpRequest as { prototype?: { send?: unknown } } | undefined)?.prototype;
    const send = prototype?.send;
    const uninstall = installXhr({ clock: () => 0, redaction: secretKeys });
    try {
      if (prototype !== undefined) {
        expect(prototype.send).not.toBe(send);
      }
    } finally {
      uninstall();
    }

    expect(prototype?.send).toBe(send);
  });
});
