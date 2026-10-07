// biome-ignore-all lint/security/noSecrets: every fixture is a published test vector or digest, flagged only for its entropy
import { describe, expect, test } from "vitest";
import { hmacSha256, hmacSha256Hex, sha256, toHex } from "./hmac-sha256";

const encoder = new TextEncoder();

function bytes(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}

function sha256Hex(message: string): string {
  return toHex(sha256(encoder.encode(message)));
}

describe("sha256 — NIST FIPS 180-4 vectors", () => {
  test("the empty message", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("abc", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("the 448-bit message", () => {
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  test("the 896-bit message", () => {
    expect(
      sha256Hex("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"),
    ).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  test("one million repetitions of a", () => {
    expect(toHex(sha256(bytes(1_000_000, 0x61)))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });
});

describe("sha256 — padding around the block boundary", () => {
  test.each([
    [55, "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"],
    [56, "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"],
    [63, "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34"],
    [64, "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"],
    [65, "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0"],
    [119, "31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb"],
    [120, "2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c"],
  ])("%i bytes of a", (length, digest) => {
    expect(toHex(sha256(bytes(length, 0x61)))).toBe(digest);
  });

  test("leaves its input untouched", () => {
    const message = bytes(56, 0x61);
    sha256(message);
    expect(message).toEqual(bytes(56, 0x61));
  });
});

describe("sha256 — non-ASCII input", () => {
  test("hashes the UTF-8 encoding of the text", () => {
    expect(sha256Hex("héllo, 世界 🌍")).toBe("dcf760dd76bf9a2108fdd1d95cece11d9dc412b705c1984a7f1541caae36a1fa");
  });
});

describe("hmacSha256 — RFC 4231 vectors", () => {
  test("case 1: a 20-byte key", () => {
    expect(toHex(hmacSha256(bytes(20, 0x0b), encoder.encode("Hi There")))).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  test("case 2: a key shorter than the output", () => {
    expect(toHex(hmacSha256(encoder.encode("Jefe"), encoder.encode("what do ya want for nothing?")))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  test("case 3: 50 bytes of combined key and data", () => {
    expect(toHex(hmacSha256(bytes(20, 0xaa), bytes(50, 0xdd)))).toBe("773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe");
  });

  test("case 4: a 25-byte counting key", () => {
    const key = Uint8Array.from({ length: 25 }, (_, i) => i + 1);
    expect(toHex(hmacSha256(key, bytes(50, 0xcd)))).toBe("82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b");
  });

  test("case 5: the leading 128 bits", () => {
    expect(toHex(hmacSha256(bytes(20, 0x0c), encoder.encode("Test With Truncation"))).slice(0, 32)).toBe(
      "a3b6167473100ee06e0c796c2955552b",
    );
  });

  test("case 6: a 131-byte key, longer than the block", () => {
    expect(toHex(hmacSha256(bytes(131, 0xaa), encoder.encode("Test Using Larger Than Block-Size Key - Hash Key First")))).toBe(
      "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
    );
  });

  test("case 7: a key and data both longer than the block", () => {
    const data =
      "This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.";
    expect(toHex(hmacSha256(bytes(131, 0xaa), encoder.encode(data)))).toBe(
      "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2",
    );
  });
});

describe("hmacSha256 — key length around the block", () => {
  test("a 64-byte key is used as the block, not hashed", () => {
    expect(toHex(hmacSha256(bytes(64, 0x0b), encoder.encode("Hi There")))).toBe(
      "21cd586aeca0579d99a1c938127c92525a371f807bc5ba6eb78bc825bd4f2be3",
    );
  });

  test("a 65-byte key is hashed first", () => {
    expect(toHex(hmacSha256(bytes(65, 0x0b), encoder.encode("Hi There")))).toBe(
      "727b82fba264393c5d67fd6d6ad783e9019a1fa6a857fccb70f5852f04be5d5d",
    );
  });

  test("an empty key and message", () => {
    expect(toHex(hmacSha256(new Uint8Array(0), new Uint8Array(0)))).toBe(
      "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad",
    );
  });
});

describe("hmacSha256Hex", () => {
  test("encodes a string key and the message as UTF-8", () => {
    expect(hmacSha256Hex("clé 🔑", "héllo, 世界 🌍")).toBe("f95a6128b34c0701d9e6baab6bca56b344ce4e5140b7b593bebd88580c7b30fd");
  });

  test("a string key and its UTF-8 bytes give the same digest", () => {
    expect(hmacSha256Hex(encoder.encode("Jefe"), "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });

  test("a lone surrogate is encoded as U+FFFD", () => {
    const digest = "7e59d236b3cb157a27dbf10f02bd18ce577c1cec1be520108741c63ed8508a98";
    expect(hmacSha256Hex("key", "a\uD800b")).toBe(digest);
    expect(hmacSha256Hex("key", "a\uDC00b")).toBe(digest);
    expect(hmacSha256Hex("key", "a�b")).toBe(digest);
  });

  test("is 64 lowercase hex characters", () => {
    expect(hmacSha256Hex("k", "m")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("toHex", () => {
  test("pads each byte to two characters", () => {
    expect(toHex(Uint8Array.from([0, 1, 15, 16, 255]))).toBe("00010f10ff");
    expect(toHex(new Uint8Array(0))).toBe("");
  });
});
