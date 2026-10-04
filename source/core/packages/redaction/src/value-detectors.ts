import type { Detector } from "./key-matcher";

/**
 * Built-in value detectors for common secret and personal-data shapes. A scanned value is
 * attacker-controlled, so every pattern costs time linear in the value's length. A quantifier is
 * either length-bounded, or unbounded over a single character class that a literal separator or the
 * end of its run terminates, behind a leading anchor (a lookbehind or a word boundary) that rejects a
 * start position inside that run in constant time, so a run is scanned from a bounded number of start
 * positions. No two adjacent quantifiers can consume the same character in more than a bounded number
 * of ways. Patterns carry no `g` or `y` flag; the detector engine makes its own global copy of each.
 */

/**
 * A JSON Web Token: three base64url segments joined by dots, the header starting `eyJ` (the
 * encoding of `{"`). The signature may be empty, as in an unsecured token. No segment has a length
 * bound, so a token with oversized claims is covered to the end of its signature run rather than
 * missed: a bound would make a longer segment fail to reach its dot and the whole token go unmatched.
 */
export const jwt: Detector = Object.freeze({
  pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/,
});

/**
 * An `Authorization: Bearer` credential, scheme word included, so the span reveals neither the token
 * nor that a bearer token sat there. The token is RFC 6750's `b64token`: URL-safe and standard
 * base64 characters plus `-._~+/`, then trailing `=` padding. The token has no length bound, so the
 * span runs to the end of the b64token run however long it is, and no tail of a long credential is
 * kept.
 */
export const bearerToken: Detector = Object.freeze({
  pattern: /\bBearer[ \t]{1,16}[A-Za-z0-9\-._~+/]+=*/i,
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
 * A payment card number, accepted only when it passes the Luhn checksum: 13 to 19 contiguous digits,
 * or a standard grouping with one separator, a space or a hyphen, used throughout — 4-4-4 then 1 to 7
 * digits, or 4-6-4 (Diners Club) or 4-6-5 (Amex). A 19-digit number is matched when written
 * contiguously; in 4-4-4-4-3 groups it is read by its leading 16 digits and redacted only when those
 * pass Luhn, because a regex cannot retry a shorter candidate once `validate` rejects a longer one,
 * and trying 4-4-4-4-3 first would leak a card number written next to its CVV. The candidate cannot touch another digit on either side, so a longer
 * contiguous run such as an order id is never redacted piecemeal, but a separator and digits may
 * follow it: a CVV or an expiry date written after the number (`4111 1111 1111 1111 123`,
 * `4111111111111111 12/25`) is left out of the candidate, which then passes Luhn on the card number
 * alone. The cost is that a longer grouped number is read by its leading groups: when the first 13
 * to 19 of its digits happen to pass Luhn, that prefix is redacted. A card number written in any
 * other grouping, or with mixed separators, is not matched.
 */
export const creditCard: Detector = Object.freeze({
  pattern: /(?<!\d)(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}|\d{4}([ -])\d{6}\2\d{4,5})(?!\d)/,
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
