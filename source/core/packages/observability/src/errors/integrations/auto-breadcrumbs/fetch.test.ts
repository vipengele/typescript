// biome-ignore-all lint/security/noSecrets: every fixture is a URL, flagged only for its entropy
import { breadcrumbs, Scope } from "@vipengele/ts-core-common/scope";
import { createManualTime } from "@vipengele/ts-core-common/testing";
import { type RedactionPolicy, secretKeys } from "@vipengele/ts-core-redaction";
import { afterEach, describe, expect, test } from "vitest";
import { suppressBreadcrumbs } from "../../../breadcrumb-suppression";
import { type FetchInstrumentationOptions, type FetchTarget, installFetch } from "./fetch";

const uninstalls: (() => void)[] = [];

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) {
    uninstall();
  }
});

interface Deferred {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

/** A stand-in holder of `fetch` whose calls stay pending until the test settles them. */
function fakeFetch() {
  const calls: { self: unknown; args: unknown[] }[] = [];
  const pending: Deferred[] = [];
  const target = {
    fetch(this: unknown, ...args: unknown[]): Promise<unknown> {
      calls.push({ self: this, args });
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
  };
  return { target, calls, pending, call: (...args: unknown[]) => target.fetch(...args) };
}

function installed(options: FetchInstrumentationOptions, target: FetchTarget): () => void {
  const uninstall = installFetch(options, target);
  uninstalls.push(uninstall);
  return uninstall;
}

/** Runs `fn` in a fresh Unit of Work and returns the trail it left once `fn` settled. */
function trailOf(fn: () => Promise<unknown>) {
  return Scope.isolated("test", {}, async () => {
    const scope = Scope.current();
    await fn();
    return breadcrumbs(scope);
  });
}

function response(status: number): { status: number } {
  return { status };
}

describe("installFetch", () => {
  test("records one crumb at settlement with method, redacted URL, status and duration", async () => {
    const time = createManualTime(5_000);
    const fake = fakeFetch();
    installed({ clock: time.clock, redaction: secretKeys }, fake.target);
    const resolved = response(200);

    const trail = await trailOf(async () => {
      const result = fake.call("https://api.example.com/items?token=abc&page=2");
      await time.advance(40);
      fake.pending[0]?.resolve(resolved);
      expect(await result).toBe(resolved);
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

  test("calls the original with the same this and arguments", async () => {
    const fake = fakeFetch();
    installed({ clock: () => 0, redaction: secretKeys }, fake.target);
    const init = { method: "POST" };

    const result = fake.target.fetch("/a", init);
    fake.pending[0]?.resolve(response(201));
    await result;

    expect(fake.calls).toEqual([{ self: fake.target, args: ["/a", init] }]);
  });

  test.each([
    [200, "info"],
    [399, "info"],
    [400, "warn"],
    [499, "warn"],
    [500, "error"],
    [503, "error"],
  ])("a status of %i records at %s", async (status, level) => {
    const fake = fakeFetch();
    installed({ clock: () => 0, redaction: secretKeys }, fake.target);

    const [crumb] = await trailOf(async () => {
      const result = fake.call("/x");
      fake.pending[0]?.resolve(response(status));
      await result;
    });

    expect(crumb?.level).toBe(level);
    expect(crumb?.data?.status_code).toBe(status);
  });

  test("a resolution without a numeric status records at info without status_code", async () => {
    const fake = fakeFetch();
    installed({ clock: () => 0, redaction: secretKeys }, fake.target);

    const [crumb] = await trailOf(async () => {
      const result = fake.call("/x");
      fake.pending[0]?.resolve(undefined);
      await result;
    });

    expect(crumb?.level).toBe("info");
    expect(crumb?.data).toEqual({ method: "GET", url: "/x", duration_ms: 0 });
  });

  test("a status whose read throws records without status_code", async () => {
    const fake = fakeFetch();
    installed({ clock: () => 0, redaction: secretKeys }, fake.target);
    const hostile = {
      get status(): number {
        throw new Error("no status");
      },
    };

    const [crumb] = await trailOf(async () => {
      const result = fake.call("/x");
      fake.pending[0]?.resolve(hostile);
      expect(await result).toBe(hostile);
    });

    expect(crumb?.data).toEqual({ method: "GET", url: "/x", duration_ms: 0 });
  });

  test("a rejection records at error with the error's name and rejects with the same reason", async () => {
    const time = createManualTime(0);
    const fake = fakeFetch();
    installed({ clock: time.clock, redaction: secretKeys }, fake.target);
    const failure = new TypeError("network down");

    const trail = await trailOf(async () => {
      const result = fake.call("/x", { method: "delete" });
      await time.advance(7);
      fake.pending[0]?.reject(failure);
      await expect(result).rejects.toBe(failure);
    });

    expect(trail).toEqual([
      {
        time: 7,
        category: "http",
        level: "error",
        message: "DELETE /x",
        data: { method: "DELETE", url: "/x", duration_ms: 7, error: "TypeError" },
      },
    ]);
  });

  test("a rejection with a value that has no name records the name Error", async () => {
    const fake = fakeFetch();
    installed({ clock: () => 0, redaction: secretKeys }, fake.target);
    const nameless = {
      get name(): string {
        throw new Error("no name");
      },
    };

    const trail = await trailOf(async () => {
      const first = fake.call("/a");
      const second = fake.call("/b");
      fake.pending[0]?.reject("plain string");
      fake.pending[1]?.reject(nameless);
      await expect(first).rejects.toBe("plain string");
      await expect(second).rejects.toBe(nameless);
    });

    expect(trail.map((crumb) => crumb.data?.error)).toEqual(["Error", "Error"]);
  });

  test("reads the method and URL of a Request, with init.method overriding", async () => {
    const fake = fakeFetch();
    installed({ clock: () => 0, redaction: secretKeys }, fake.target);
    const request = new Request("https://example.com/r?token=abc", { method: "PUT" });

    const trail = await trailOf(async () => {
      const first = fake.call(request);
      const second = fake.call(request, { method: "PATCH" });
      fake.pending[0]?.resolve(response(204));
      fake.pending[1]?.resolve(response(204));
      await Promise.all([first, second]);
    });

    expect(trail.map((crumb) => crumb.message)).toEqual([
      "PUT https://example.com/r?token=[REDACTED]",
      "PATCH https://example.com/r?token=[REDACTED]",
    ]);
  });

  test("reads a URL input through its string form", async () => {
    const fake = fakeFetch();
    installed({ clock: () => 0, redaction: secretKeys }, fake.target);

    const [crumb] = await trailOf(async () => {
      const result = fake.call(new URL("https://example.com/u?api_key=k"));
      fake.pending[0]?.resolve(response(200));
      await result;
    });

    expect(crumb?.message).toBe("GET https://example.com/u?api_key=[REDACTED]");
  });

  test("redacts with the install's policy", async () => {
    const fake = fakeFetch();
    const policy: RedactionPolicy = { keys: ["page"] };
    installed({ clock: () => 0, redaction: policy }, fake.target);

    const [crumb] = await trailOf(async () => {
      const result = fake.call("/x?token=t&page=2");
      fake.pending[0]?.resolve(response(200));
      await result;
    });

    expect(crumb?.data?.url).toBe("/x?token=t&page=[REDACTED]");
  });

  test("defaults a missing clock and redaction, as another copy's entry may have", async () => {
    const fake = fakeFetch();
    installed({} as FetchInstrumentationOptions, fake.target);
    const before = Date.now();

    const [crumb] = await trailOf(async () => {
      const result = fake.call("/x?token=t");
      fake.pending[0]?.resolve(response(200));
      await result;
    });

    expect(crumb?.time).toBeGreaterThanOrEqual(before);
    expect(crumb?.data?.url).toBe("/x?token=[REDACTED]");
  });

  test("a fetch started while suppressed records nothing when it settles", async () => {
    const fake = fakeFetch();
    installed({ clock: () => 0, redaction: secretKeys }, fake.target);

    const trail = await trailOf(async () => {
      const result = suppressBreadcrumbs(() => fake.call("/internal"));
      fake.pending[0]?.resolve(response(200));
      await result;
    });

    expect(trail).toEqual([]);
  });

  test("a fetch settling after every install is torn down records with its call-time options", async () => {
    const time = createManualTime(100);
    const fake = fakeFetch();
    const uninstall = installed({ clock: time.clock, redaction: { keys: ["page"] } }, fake.target);
    const wrapper = fake.target.fetch;

    const trail = await trailOf(async () => {
      const result = fake.call("/x?page=2");
      uninstall();
      await time.advance(3);
      fake.pending[0]?.resolve(response(200));
      await result;
    });

    expect(fake.target.fetch).not.toBe(wrapper);
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

  test("restores the original when the last install leaves", () => {
    const fake = fakeFetch();
    const original = fake.target.fetch;
    const uninstall = installFetch({ clock: () => 0, redaction: secretKeys }, fake.target);

    expect(fake.target.fetch).not.toBe(original);
    uninstall();

    expect(fake.target.fetch).toBe(original);
  });

  test("a wrapper left under another party's wrapper passes through without recording", async () => {
    const fake = fakeFetch();
    const uninstall = installFetch({ clock: () => 0, redaction: secretKeys }, fake.target);
    const ours = fake.target.fetch;
    fake.target.fetch = (...args: unknown[]) => ours.apply(fake.target, args);
    uninstall();

    const trail = await trailOf(async () => {
      const result = fake.call("/x");
      fake.pending[0]?.resolve(response(200));
      await result;
    });

    expect(trail).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  test("a synchronous throw from the original propagates unrecorded", () => {
    const failure = new Error("sync");
    const target: FetchTarget = {
      fetch() {
        throw failure;
      },
    };
    installed({ clock: () => 0, redaction: secretKeys }, target);

    const trail = Scope.isolated("test", {}, () => {
      expect(() => target.fetch?.()).toThrow(failure);
      return breadcrumbs(Scope.current());
    });

    expect(trail).toEqual([]);
  });

  test.each([{ not: "a promise" }, 42])("returns a result that is not a thenable, %o, as it is, unrecorded", (value) => {
    const target: FetchTarget = { fetch: () => value };
    installed({ clock: () => 0, redaction: secretKeys }, target);

    const trail = Scope.isolated("test", {}, () => {
      expect(target.fetch?.("/x")).toBe(value);
      return breadcrumbs(Scope.current());
    });

    expect(trail).toEqual([]);
  });

  test("returns a result whose then cannot be read as it is", () => {
    // biome-ignore lint/suspicious/noThenProperty: a thenable whose `then` getter throws is the case under test
    const value = Object.defineProperty({}, "then", {
      get(): unknown {
        throw new Error("no then");
      },
    });
    const target: FetchTarget = { fetch: () => value };
    installed({ clock: () => 0, redaction: secretKeys }, target);

    expect(target.fetch?.("/x")).toBe(value);
  });

  test("passes through unrecorded when reading the call fails", async () => {
    const fake = fakeFetch();
    installed({ clock: () => 0, redaction: secretKeys }, fake.target);
    const unprintable = {
      toString(): string {
        throw new Error("no string");
      },
    };

    const trail = await trailOf(async () => {
      const result = fake.call(unprintable);
      fake.pending[0]?.resolve(response(200));
      await result;
    });

    expect(trail).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  test("a clock that throws at settlement drops the crumb and keeps the outcome", async () => {
    const fake = fakeFetch();
    let reads = 0;
    const clock = () => {
      reads += 1;
      if (reads > 1) {
        throw new Error("clock failed");
      }
      return 0;
    };
    installed({ clock, redaction: secretKeys }, fake.target);
    const resolved = response(200);

    const trail = await trailOf(async () => {
      const result = fake.call("/x");
      fake.pending[0]?.resolve(resolved);
      expect(await result).toBe(resolved);
    });

    expect(trail).toEqual([]);
  });

  test("installs nothing on a target that is not an object", () => {
    const uninstall = installFetch({ clock: () => 0, redaction: secretKeys }, null as unknown as FetchTarget);

    expect(() => uninstall()).not.toThrow();
  });

  test("patches the realm's fetch by default", () => {
    const original = globalThis.fetch;
    const uninstall = installFetch({ clock: () => 0, redaction: secretKeys });
    try {
      expect(globalThis.fetch).not.toBe(original);
    } finally {
      uninstall();
    }

    expect(globalThis.fetch).toBe(original);
  });
});
