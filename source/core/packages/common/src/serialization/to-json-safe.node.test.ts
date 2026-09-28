import { expect, test } from "vitest";
import { toJsonSafe } from "./to-json-safe";

interface BufferClassLike {
  from(text: string): Uint8Array & { toJSON(): unknown };
}

const { Buffer } = globalThis as unknown as { Buffer: BufferClassLike };

test("describes a Buffer by its class and byte length instead of calling its toJSON", () => {
  const buffer = Buffer.from("hello");

  expect(toJsonSafe(buffer)).toBe("[Buffer: 5 bytes]");
  expect(toJsonSafe({ buffer })).toEqual({ buffer: "[Buffer: 5 bytes]" });
});
