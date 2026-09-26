import { expect, test } from "vitest";
import type { ContextCarrier } from "../global-registry";
import { createNodeAsyncLocalStorageCarrier } from "./node-async-local-storage-carrier";

function realCarrier(): ContextCarrier<string> {
  const carrier = createNodeAsyncLocalStorageCarrier("default");
  if (carrier === undefined) {
    throw new Error("Node exposes AsyncLocalStorage through process.getBuiltinModule");
  }
  return carrier;
}

test("Node's own AsyncLocalStorage backs the carrier without an injected source", () => {
  expect(createNodeAsyncLocalStorageCarrier("default")).toBeDefined();
});

test("the installed value survives an await inside run", async () => {
  const carrier = realCarrier();

  const afterAwait = await carrier.run("installed", async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return carrier.current();
  });

  expect(afterAwait).toBe("installed");
});

test("concurrent runs each keep their own value across awaits", async () => {
  const carrier = realCarrier();
  const observe = (value: string, delay: number) =>
    carrier.run(value, async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return carrier.current();
    });

  expect(await Promise.all([observe("slow", 10), observe("fast", 0)])).toEqual(["slow", "fast"]);
});

test("the prior value is restored after run returns", () => {
  const carrier = realCarrier();

  const seen = carrier.run("outer", () => {
    carrier.run("inner", () => undefined);
    return carrier.current();
  });

  expect(seen).toBe("outer");
  expect(carrier.current()).toBe("default");
});

test("the prior value is restored after run throws", () => {
  const carrier = realCarrier();
  const failure = new Error("fn failed");

  const seen = carrier.run("outer", () => {
    expect(() =>
      carrier.run("inner", () => {
        throw failure;
      }),
    ).toThrow(failure);
    return carrier.current();
  });

  expect(seen).toBe("outer");
  expect(carrier.current()).toBe("default");
});

test("the prior value is restored after an async run's promise rejects", async () => {
  const carrier = realCarrier();
  const failure = new Error("fn failed");

  const seen = await carrier.run("outer", async () => {
    await expect(
      carrier.run("inner", async () => {
        await Promise.resolve();
        throw failure;
      }),
    ).rejects.toBe(failure);
    return carrier.current();
  });

  expect(seen).toBe("outer");
});
