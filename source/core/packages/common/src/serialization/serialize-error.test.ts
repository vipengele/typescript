import { describe, expect, test } from "vitest";
import { VipengeleError } from "../errors/vipengele-error";
import { type SerializedError, serializeError } from "./index";

// biome-ignore lint/security/noSecrets: a fixed marker string, flagged only for its entropy
const CUT = "…[truncated]";

class PaymentDeclinedError extends VipengeleError {
  readonly code = "payment.declined";
}

/** An error `links` causes deep: the outermost is `"link 0"`, its innermost cause `"link <links>"`. */
function chain(links: number): Error {
  let error = new Error(`link ${links}`);
  for (let link = links - 1; link >= 0; link--) {
    error = new Error(`link ${link}`, { cause: error });
  }
  return error;
}

/** The messages along the `cause` chain, outermost first. */
function messages(serialized: SerializedError): string[] {
  const result: string[] = [];
  for (let node: SerializedError | undefined = serialized; node !== undefined; node = node.cause) {
    result.push(node.message);
  }
  return result;
}

describe("an Error", () => {
  test("gives its type, message and raw stack, and nothing else when it has no more", () => {
    const error = new TypeError("bad input");

    expect(serializeError(error)).toEqual({ type: "TypeError", message: "bad input", stack: error.stack });
  });

  test("gives a VipengeleError's code", () => {
    const error = new PaymentDeclinedError("declined");

    expect(serializeError(error)).toMatchObject({ type: "PaymentDeclinedError", message: "declined", code: "payment.declined" });
  });

  test("gives an errno code", () => {
    const error = Object.assign(new Error("no such file"), { code: "ENOENT" });

    expect(serializeError(error)).toMatchObject({ code: "ENOENT" });
  });

  test("ignores a code that is not a string", () => {
    const error = Object.assign(new Error("numeric"), { code: 42 });

    expect(serializeError(error)).not.toHaveProperty("code");
  });

  test("ignores a code whose getter throws", () => {
    const error = Object.defineProperty(new Error("opaque"), "code", {
      get(): never {
        throw new Error("no code");
      },
    });

    expect(serializeError(error)).not.toHaveProperty("code");
  });
});

describe("data", () => {
  test("takes own enumerable properties, normalized, with an assigned cause and errors left to the chain", () => {
    const error = Object.assign(new Error("with data"), { userId: 42, seenAt: new Date(0), tags: new Set(["a"]) });
    error.cause = new Error("assigned");
    Object.assign(error, { errors: [new Error("listed")] });

    const serialized = serializeError(error);

    expect(serialized.data).toEqual({ userId: 42, seenAt: "1970-01-01T00:00:00.000Z", tags: ["a"] });
    expect(serialized.cause).toMatchObject({ message: "assigned" });
    expect(serialized.errors).toMatchObject([{ message: "listed" }]);
  });

  test("is absent when the only own enumerable properties belong to the chain", () => {
    const error = new Error("assigned cause only");
    error.cause = new Error("assigned");

    expect(serializeError(error)).not.toHaveProperty("data");
  });

  test("marks a property whose getter throws unreadable, keeping the rest", () => {
    const error = Object.defineProperty(Object.assign(new Error("partial"), { kept: 1 }), "broken", {
      enumerable: true,
      get(): never {
        throw new Error("no value");
      },
    });

    expect(serializeError(error).data).toEqual({ kept: 1, broken: "[Unreadable]" });
  });

  test("is absent when the error's keys cannot be listed", () => {
    const error = new Proxy(new Error("unlistable"), {
      ownKeys(): never {
        throw new Error("no keys");
      },
    });

    const serialized = serializeError(error);

    expect(serialized).toMatchObject({ type: "Error", message: "unlistable" });
    expect(serialized).not.toHaveProperty("data");
  });
});

describe("a thrown value that is not an Error", () => {
  test.for<[string, unknown, string]>([
    ["a string", "boom", "boom"],
    ["a number", 42, "42"],
    ["undefined", undefined, "null"],
    ["a plain object", { reason: "gone", at: new Date(0) }, '{"reason":"gone","at":"1970-01-01T00:00:00.000Z"}'],
  ])("gives %s as a synthetic Error", ([, value, message]) => {
    expect(serializeError(value)).toEqual({ type: "Error", message, synthetic: true });
  });

  test("gives a revoked Proxy as a synthetic Error", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(serializeError(proxy)).toEqual({ type: "Error", message: "[Unreadable]", synthetic: true });
  });

  test("bounds a long JSON form at the string length limit", () => {
    const message = serializeError(Array.from({ length: 100 }, () => "x".repeat(8192))).message;

    expect(message).toHaveLength(8192 + CUT.length);
    expect(message.endsWith(CUT)).toBe(true);
  });

  test("is synthetic as a cause too", () => {
    expect(serializeError(new Error("outer", { cause: "inner" })).cause).toEqual({ type: "Error", message: "inner", synthetic: true });
  });
});

describe("the chain", () => {
  test("follows cause", () => {
    const root = new RangeError("root");
    const error = new Error("outer", { cause: new TypeError("middle", { cause: root }) });

    expect(serializeError(error)).toMatchObject({
      type: "Error",
      message: "outer",
      cause: { type: "TypeError", message: "middle", cause: { type: "RangeError", message: "root", stack: root.stack } },
    });
  });

  test("follows an AggregateError's errors, each with its own chain", () => {
    const error = new AggregateError([new Error("one", { cause: new Error("why") }), "two"], "many");

    expect(serializeError(error)).toMatchObject({
      type: "AggregateError",
      message: "many",
      errors: [
        { type: "Error", message: "one", cause: { message: "why" } },
        { type: "Error", message: "two", synthetic: true },
      ],
    });
  });

  test("summarises errors beyond the first hundred in one entry", () => {
    const errors = serializeError(new AggregateError(Array.from({ length: 102 }, (_, index) => new Error(`${index}`)))).errors;

    expect(errors).toHaveLength(101);
    expect(errors?.[99]).toMatchObject({ message: "99" });
    expect(errors?.[100]).toEqual({ type: "[Truncated]", message: "2 more errors" });
  });

  test("follows five links and cuts a sixth, marking the cut", () => {
    const serialized = serializeError(chain(6));

    expect(messages(serialized)).toEqual(["link 0", "link 1", "link 2", "link 3", "link 4", "link 5", "the chain continues past 5 links"]);
    expect(serialized.cause?.cause?.cause?.cause?.cause?.cause).toEqual({
      type: "[Truncated]",
      message: "the chain continues past 5 links",
    });
  });

  test("keeps a chain of exactly five links whole", () => {
    expect(messages(serializeError(chain(5)))).toEqual(["link 0", "link 1", "link 2", "link 3", "link 4", "link 5"]);
  });

  test("counts a link into errors toward the five", () => {
    const error = new AggregateError([chain(5)], "outer");

    expect(messages(serializeError(error).errors?.[0] as SerializedError)).toEqual([
      "link 0",
      "link 1",
      "link 2",
      "link 3",
      "link 4",
      "the chain continues past 5 links",
    ]);
  });

  test("stops at a cycle, marking where it closes", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    first.cause = second;

    expect(serializeError(first)).toMatchObject({
      message: "first",
      cause: { message: "second", cause: { type: "[Circular]", message: "an error already on this chain" } },
    });
  });

  test("stops at an error that is its own cause", () => {
    const error = new Error("self");
    error.cause = error;

    expect(serializeError(error).cause).toEqual({ type: "[Circular]", message: "an error already on this chain" });
  });

  test("serializes the same error in full wherever it recurs as a sibling", () => {
    const shared = new Error("shared");

    expect(serializeError(new AggregateError([shared, shared], "twice")).errors).toEqual([
      { type: "Error", message: "shared", stack: shared.stack },
      { type: "Error", message: "shared", stack: shared.stack },
    ]);
  });

  test("ignores a cause whose getter throws", () => {
    const error = Object.defineProperty(new Error("opaque"), "cause", {
      get(): never {
        throw new Error("no cause");
      },
    });

    expect(serializeError(error)).not.toHaveProperty("cause");
  });
});
