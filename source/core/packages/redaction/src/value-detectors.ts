import type { Detector } from "./key-matcher";

/**
 * Built-in value detectors for common secret and personal-data shapes. A scanned value is
 * attacker-controlled, so every quantifier is length-bounded and no two adjacent quantifiers can
 * consume the same character in more than a bounded number of ways: the cost of a scan grows with
 * the value's length times a fixed per-position bound, never exponentially. Patterns carry no `g`
 * or `y` flag; the detector engine makes its own global copy of each.
 */

/**
 * A JSON Web Token: three base64url segments joined by dots, the header starting `eyJ` (the
 * encoding of `{"`). The signature may be empty, as in an unsecured token. A segment past its bound
 * is matched up to the bound, so an oversized token is still mostly covered.
 */
export const jwt: Detector = Object.freeze({
  pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{1,4096}\.[A-Za-z0-9_-]{1,8192}\.[A-Za-z0-9_-]{0,4096}/,
});

/**
 * An `Authorization: Bearer` credential, scheme word included, so the span reveals neither the token
 * nor that a bearer token sat there. The token is RFC 6750's `b64token`: URL-safe and standard
 * base64 characters plus `-._~+/`, then trailing `=` padding.
 */
export const bearerToken: Detector = Object.freeze({
  pattern: /\bBearer[ \t]{1,16}[A-Za-z0-9\-._~+/]{1,4096}={0,8}/i,
});

/** Whether `candidate`'s digits, separators ignored, pass the Luhn checksum every card number carries. */
function passesLuhn(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * A payment card number: 13 to 19 digits, with at most one space or hyphen between any two of them,
 * accepted only when it passes the Luhn checksum. The whole digit run has to be the candidate — a
 * digit, or a separator and a digit, on either side rules it out — so a longer run such as an order
 * id is never redacted piecemeal.
 */
export const creditCard: Detector = Object.freeze({
  pattern: /(?<!\d[ -]?)\d(?:[ -]?\d){12,18}(?![ -]?\d)/,
  validate: passesLuhn,
});

/**
 * An email address of the pragmatic `local@domain.tld` shape: a local part of up to 64 characters,
 * then up to 16 dot-terminated hostname labels of up to 63 characters each, then an alphabetic top
 * level label. A label cannot start or end with a hyphen.
 */
export const email: Detector = Object.freeze({
  pattern: /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){1,16}[A-Za-z]{2,63}/,
});

/**
 * An AWS access key id: a key-type prefix (`AKIA` long-term, `ASIA` temporary, `ABIA` STS service
 * bearer, `ACCA` context-specific) then 16 uppercase alphanumerics, as a whole word.
 */
export const awsAccessKey: Detector = Object.freeze({
  pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/,
});

/**
 * A GitHub token, as a whole word: a classic `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` token of at least 36
 * alphanumerics, or a fine-grained `github_pat_` token of at least 36 alphanumerics and underscores.
 */
export const githubToken: Detector = Object.freeze({
  pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{36,255})\b/,
});

/**
 * A Stripe secret (`sk_`) or restricted (`rk_`) key, live or test mode, as a whole word.
 * Publishable `pk_` keys are meant to be public and are not matched.
 */
export const stripeKey: Detector = Object.freeze({
  pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{24,247}\b/,
});

/** Every built-in detector, in a fixed order, for a policy's `detectors`. */
export const valueDetectors: readonly Detector[] = Object.freeze([
  jwt,
  bearerToken,
  creditCard,
  email,
  awsAccessKey,
  githubToken,
  stripeKey,
]);
