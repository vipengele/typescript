import { describe, expect, test } from "vitest";
import { compileChain, compose, sortFilters, type Terminal } from "./chain";
import { createRootContext, type HttpContext } from "./context";
import { isHttpConfigError } from "./errors/http-errors";
import { type Filter, filter, type Next } from "./filter";

const rootContext = () =>
  createRootContext({ url: new URL("https://example.com/"), method: "GET", headers: new Headers() }, async () => new Response("unused"));

/** A terminal that records every context it reaches and answers 200. */
function recordingTerminal() {
  const seen: HttpContext[] = [];
  const terminal: Terminal = async (ctx) => {
    seen.push(ctx);
    return new Response("ok");
  };
  return { seen, terminal };
}

/** A filter that logs its name on the way in and out and otherwise passes the call through. */
function tracing(name: string, order: number, log: string[], allowsOrderTie?: boolean): Filter {
  return filter({
    name,
    order,
    ...(allowsOrderTie === undefined ? {} : { allowsOrderTie }),
    async handle(_ctx, next) {
      log.push(`>${name}`);
      const response = await next();
      log.push(`<${name}`);
      return response;
    },
  });
}

function configErrorOf(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    expect(isHttpConfigError(error)).toBe(true);
    return error as Error;
  }
  throw new Error("expected an HttpConfigError");
}

describe("ordering", () => {
  test("runs filters outermost to innermost by order, whatever the registration order", async () => {
    const log: string[] = [];
    const { terminal, seen } = recordingTerminal();
    const run = compileChain([tracing("inner", 2000, log), tracing("outer", 100, log), tracing("middle", 1000, log)], terminal);

    await run(rootContext());

    expect(log).toEqual([">outer", ">middle", ">inner", "<inner", "<middle", "<outer"]);
    expect(seen).toHaveLength(1);
  });

  test("an empty chain calls the terminal directly", async () => {
    const { terminal, seen } = recordingTerminal();
    const ctx = rootContext();

    await compileChain([], terminal)(ctx);

    expect(seen).toEqual([ctx]);
  });

  test("sortFilters leaves its input alone", () => {
    const log: string[] = [];
    const filters = [tracing("b", 2, log), tracing("a", 1, log)];
    const sorted = sortFilters(filters);

    expect(sorted.map((f) => f.name)).toEqual(["a", "b"]);
    expect(filters.map((f) => f.name)).toEqual(["b", "a"]);
  });

  test("rejects two filters at one order, naming both", () => {
    const log: string[] = [];
    const error = configErrorOf(() => sortFilters([tracing("first", 10, log), tracing("other", 1, log), tracing("second", 10, log)]));

    expect(error.message).toContain('"first"');
    expect(error.message).toContain('"second"');
    expect(error.message).toContain("10");
  });

  test("runs a tie in registration order when every filter at that order opts in", async () => {
    const log: string[] = [];
    const { terminal } = recordingTerminal();
    const run = compileChain(
      [tracing("b", 5, log, true), tracing("outer", 1, log), tracing("a", 5, log, true), tracing("c", 5, log, true)],
      terminal,
    );

    await run(rootContext());

    expect(log.filter((entry) => entry.startsWith(">"))).toEqual([">outer", ">b", ">a", ">c"]);
  });

  test("rejects a tie when only the later filter opts in", () => {
    const log: string[] = [];
    const error = configErrorOf(() => sortFilters([tracing("plain", 5, log), tracing("willing", 5, log, true)]));

    expect(error.message).toContain('"plain"');
    expect(error.message).toContain('"willing"');
  });

  test("rejects a tie when a later filter does not opt in, naming it", () => {
    const log: string[] = [];
    const error = configErrorOf(() =>
      sortFilters([tracing("willing", 5, log, true), tracing("also", 5, log, true), tracing("plain", 5, log)]),
    );

    expect(error.message).toContain('"willing"');
    expect(error.message).toContain('"plain"');
  });
});

describe("next", () => {
  test("with no argument passes on the context the filter received", async () => {
    const { terminal, seen } = recordingTerminal();
    const ctx = rootContext();
    const run = compose([filter({ name: "pass", order: 1, handle: (_ctx, next) => next() })], terminal);

    await run(ctx);

    expect(seen).toEqual([ctx]);
  });

  test("with a context passes that context downstream", async () => {
    const { terminal, seen } = recordingTerminal();
    const replacement = rootContext();
    const received: HttpContext[] = [];
    const run = compose(
      [
        filter({ name: "swap", order: 1, handle: (_ctx, next) => next(replacement) }),
        filter({
          name: "inner",
          order: 2,
          handle: (ctx, next) => {
            received.push(ctx);
            return next();
          },
        }),
      ],
      terminal,
    );

    await run(rootContext());

    expect(received).toEqual([replacement]);
    expect(seen).toEqual([replacement]);
  });

  test("with a fork passes the next attempt downstream", async () => {
    const { terminal, seen } = recordingTerminal();
    const ctx = rootContext();
    const run = compose([filter({ name: "fork", order: 1, handle: (current, next) => next(current.fork()) })], terminal);

    await run(ctx);

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe(ctx);
    expect(seen[0]?.attempt).toBe(2);
    expect(seen[0]?.attributes).toBe(ctx.attributes);
  });

  test("called twice runs everything downstream twice", async () => {
    const { terminal, seen } = recordingTerminal();
    const log: string[] = [];
    const twice = filter({
      name: "twice",
      order: 1,
      async handle(ctx, next: Next) {
        await next(ctx.fork());
        return next(ctx.fork());
      },
    });
    const run = compileChain([tracing("inner", 2, log), twice], terminal);

    await run(rootContext());

    expect(log).toEqual([">inner", "<inner", ">inner", "<inner"]);
    expect(seen.map((ctx) => ctx.attempt)).toEqual([2, 2]);
  });

  test("returns the response downstream produced", async () => {
    const response = new Response("from terminal");
    const run = compose([filter({ name: "pass", order: 1, handle: (_ctx, next) => next() })], async () => response);

    expect(await run(rootContext())).toBe(response);
  });
});

describe("failures", () => {
  test("a filter that throws synchronously gives a rejected promise", async () => {
    const failure = new Error("boom");
    const { terminal } = recordingTerminal();
    const run = compose(
      [
        filter({
          name: "throws",
          order: 1,
          handle: () => {
            throw failure;
          },
        }),
      ],
      terminal,
    );

    await expect(run(rootContext())).rejects.toBe(failure);
  });

  test("a terminal that throws synchronously gives a rejected promise", async () => {
    const failure = new Error("boom");
    const run = compose([], () => {
      throw failure;
    });

    await expect(run(rootContext())).rejects.toBe(failure);
  });
});
