import { expect, test } from "vitest";
import { createSyncStackCarrier } from "./sync-stack-carrier";

test("outside any run, current() is the default", () => {
  expect(createSyncStackCarrier("default").current()).toBe("default");
});

test("inside run, current() is the installed value", () => {
  const carrier = createSyncStackCarrier("default");

  expect(carrier.run("installed", () => carrier.current())).toBe("installed");
});

test("run returns what fn returns", () => {
  expect(createSyncStackCarrier(0).run(1, () => "result")).toBe("result");
});

test("the value is popped as soon as a synchronous fn returns", () => {
  const carrier = createSyncStackCarrier("default");

  carrier.run("installed", () => undefined);

  expect(carrier.current()).toBe("default");
});

test("a nested run restores the outer value on exit, not the default", () => {
  const carrier = createSyncStackCarrier("default");

  const seen = carrier.run("outer", () => {
    const inner = carrier.run("inner", () => carrier.current());
    return [inner, carrier.current()];
  });

  expect(seen).toEqual(["inner", "outer"]);
  expect(carrier.current()).toBe("default");
});

test("a throwing fn still pops, restoring the enclosing value", () => {
  const carrier = createSyncStackCarrier("default");
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

test("an async fn loses the installed value after its first await", async () => {
  const carrier = createSyncStackCarrier("default");
  let beforeAwait: string | undefined;

  const afterAwait = await carrier.run("installed", async () => {
    beforeAwait = carrier.current();
    await Promise.resolve();
    return carrier.current();
  });

  expect(beforeAwait).toBe("installed");
  expect(afterAwait).toBe("default");
});
