// biome-ignore-all lint/security/noSecrets: the suite names camel-cased functions in its test titles, flagged only for their entropy
import { expect, test } from "vitest";
import { hmacSha256, hmacSha256Hex, sha256, toHex } from "./hmac-sha256";

/** The slice of Node's crypto module the cross-check uses. */
interface NodeCrypto {
  createHash(algorithm: string): Digester;
  createHmac(algorithm: string, key: Uint8Array | string): Digester;
  randomBytes(size: number): Uint8Array;
  randomInt(min: number, max: number): number;
}

interface Digester {
  update(data: Uint8Array | string): Digester;
  digest(encoding: "hex"): string;
}

// The package declares no Node types and lint rejects a `node:` import specifier, so the built-in
// is reached through `process.getBuiltinModule` and typed by the interface above.
const { createHash, createHmac, randomBytes, randomInt } = (
  globalThis as unknown as { process: { getBuiltinModule(id: string): NodeCrypto } }
).process.getBuiltinModule("node:crypto");

const ROUNDS = 200;

test("sha256 matches Node's createHash on random messages", () => {
  for (let round = 0; round < ROUNDS; round++) {
    const message = randomBytes(randomInt(0, 300));
    expect(toHex(sha256(message))).toBe(createHash("sha256").update(message).digest("hex"));
  }
});

test("hmacSha256 matches Node's createHmac on random keys and messages", () => {
  for (let round = 0; round < ROUNDS; round++) {
    const key = randomBytes(randomInt(0, 200));
    const message = randomBytes(randomInt(0, 300));
    expect(toHex(hmacSha256(key, message))).toBe(createHmac("sha256", key).update(message).digest("hex"));
  }
});

test("hmacSha256Hex agrees with Node on random strings beyond ASCII", () => {
  for (let round = 0; round < ROUNDS; round++) {
    const key = randomString(randomInt(1, 80));
    const message = randomString(randomInt(0, 120));
    expect(hmacSha256Hex(key, message)).toBe(createHmac("sha256", key).update(message).digest("hex"));
  }
});

/** Random code points from ASCII through the astral planes, never a lone surrogate. */
function randomString(length: number): string {
  const ranges: readonly [number, number][] = [
    [0x20, 0x7e],
    [0xa0, 0x7ff],
    [0x800, 0xd7ff],
    [0xe000, 0xfffd],
    [0x10000, 0x10ffff],
  ];
  let text = "";
  for (let i = 0; i < length; i++) {
    const [low, high] = ranges[randomInt(0, ranges.length)] as [number, number];
    text += String.fromCodePoint(randomInt(low, high + 1));
  }
  return text;
}
