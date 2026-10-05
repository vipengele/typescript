/**
 * A synchronous SHA-256 (FIPS 180-4) and HMAC-SHA-256 (RFC 2104) in plain JavaScript. `redact` is
 * synchronous, WebCrypto's HMAC is async-only, and this package has no runtime dependencies and
 * picks no runtime-specific code, so the digest is computed here rather than borrowed from the
 * platform.
 */

/** Bytes in one SHA-256 block, and the length an HMAC key is padded or hashed to. */
const BLOCK_SIZE = 64;

/** The first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const INITIAL_HASH = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19] as const;

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Appends the `0x80` byte, zero bytes and the 64-bit big-endian bit length, so the result is a whole
 * number of blocks. A message within 8 bytes of a block boundary (55 bytes or fewer past it fits;
 * 56 to 63 does not) spills the length into one more block.
 */
function pad(message: Uint8Array): Uint8Array {
  const length = message.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / BLOCK_SIZE) * BLOCK_SIZE);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  return padded;
}

/** The 32-byte SHA-256 digest of `message`. */
export function sha256(message: Uint8Array): Uint8Array {
  const padded = pad(message);
  const view = new DataView(padded.buffer);
  const hash = Uint32Array.from(INITIAL_HASH);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += BLOCK_SIZE) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(offset + t * 4);
    }
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15] as number;
      const w2 = w[t - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t - 16] as number) + s0 + (w[t - 7] as number) + s1;
    }

    let a = hash[0] as number;
    let b = hash[1] as number;
    let c = hash[2] as number;
    let d = hash[3] as number;
    let e = hash[4] as number;
    let f = hash[5] as number;
    let g = hash[6] as number;
    let h = hash[7] as number;

    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + (K[t] as number) + (w[t] as number)) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] as number) + a;
    hash[1] = (hash[1] as number) + b;
    hash[2] = (hash[2] as number) + c;
    hash[3] = (hash[3] as number) + d;
    hash[4] = (hash[4] as number) + e;
    hash[5] = (hash[5] as number) + f;
    hash[6] = (hash[6] as number) + g;
    hash[7] = (hash[7] as number) + h;
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) {
    out.setUint32(i * 4, hash[i] as number);
  }
  return digest;
}

/**
 * The 32-byte HMAC-SHA-256 of `message` under `key`. A key longer than the 64-byte block is hashed
 * first; a shorter one is zero-padded to the block. Any key length is accepted, the empty key
 * included — deciding which keys are acceptable belongs to the caller.
 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(BLOCK_SIZE);
  block.set(key.length > BLOCK_SIZE ? sha256(key) : key);

  const inner = new Uint8Array(BLOCK_SIZE + message.length);
  const outer = new Uint8Array(BLOCK_SIZE + 32);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const byte = block[i] as number;
    inner[i] = byte ^ 0x36;
    outer[i] = byte ^ 0x5c;
  }
  inner.set(message, BLOCK_SIZE);
  outer.set(sha256(inner), BLOCK_SIZE);
  return sha256(outer);
}

/** `bytes` as lowercase hexadecimal, two characters per byte. */
export function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * The HMAC-SHA-256 of `message` under `key` as 64 lowercase hex characters. A string key and the
 * message are encoded as UTF-8 with `TextEncoder`, which turns a lone surrogate into U+FFFD — so
 * two strings differing only in which lone surrogate they carry give the same digest.
 */
export function hmacSha256Hex(key: string | Uint8Array, message: string): string {
  const encoder = new TextEncoder();
  return toHex(hmacSha256(typeof key === "string" ? encoder.encode(key) : key, encoder.encode(message)));
}
