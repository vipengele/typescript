import { describe, expect, test } from "vitest";
import { isOneShotBody, toReadableStream } from "./body";

const bytes = (text: string) => new TextEncoder().encode(text);

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

describe(isOneShotBody.name, () => {
  test.each([
    ["a string", "payload"],
    ["an empty string", ""],
    ["a Blob", new Blob(["x"])],
    ["FormData", new FormData()],
    ["URLSearchParams", new URLSearchParams("a=1")],
    ["an ArrayBuffer", new ArrayBuffer(4)],
    ["a Uint8Array", bytes("x")],
    ["null", null],
    ["undefined", undefined],
  ])("treats %s as replayable", (_, body) => {
    expect(isOneShotBody(body)).toBe(false);
  });

  test("treats a ReadableStream as one-shot", () => {
    expect(isOneShotBody(new ReadableStream())).toBe(true);
  });

  test("treats an async generator as one-shot", () => {
    async function* chunks() {
      yield bytes("x");
    }
    expect(isOneShotBody(chunks())).toBe(true);
  });

  test("treats any object with Symbol.asyncIterator as one-shot", () => {
    const iterable: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
    };
    expect(isOneShotBody(iterable)).toBe(true);
  });
});

describe("toReadableStream", () => {
  test("yields the generator's bytes and closes when it ends", async () => {
    async function* chunks() {
      yield bytes("hello, ");
      yield bytes("world");
    }
    expect(await readAll(toReadableStream(chunks()))).toBe("hello, world");
  });

  test("reports done after the last chunk", async () => {
    async function* chunks() {
      yield bytes("a");
    }
    const reader = toReadableStream(chunks()).getReader();
    expect((await reader.read()).done).toBe(false);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  test("cancelling the stream returns the generator", async () => {
    let finalized = false;
    async function* chunks() {
      try {
        yield bytes("a");
        yield bytes("b");
      } finally {
        finalized = true;
      }
    }
    const reader = toReadableStream(chunks()).getReader();
    await reader.read();
    await reader.cancel("stop");
    expect(finalized).toBe(true);
  });

  test("passes the cancel reason to the iterator's return", async () => {
    const reasons: unknown[] = [];
    const iterable: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: bytes("a") }),
        return: async (reason?: unknown) => {
          reasons.push(reason);
          return { done: true, value: undefined };
        },
      }),
    };
    await toReadableStream(iterable).cancel("stop");
    expect(reasons).toEqual(["stop"]);
  });

  test("cancels cleanly when the iterator has no return", async () => {
    const iterable: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: bytes("a") }) }),
    };
    await expect(toReadableStream(iterable).cancel("stop")).resolves.toBeUndefined();
  });

  test("errors the stream when the iterator throws", async () => {
    const failure = new Error("source failed");
    async function* chunks() {
      yield bytes("a");
      throw failure;
    }
    const reader = toReadableStream(chunks()).getReader();
    await reader.read();
    await expect(reader.read()).rejects.toBe(failure);
  });
});
