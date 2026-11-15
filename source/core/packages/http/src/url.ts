import { redactUrl } from "@vipengele/ts-core-redaction";
import { HttpConfigError } from "./errors/http-errors";

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

function parse(href: string): URL {
  try {
    return new URL(href);
  } catch {
    // The platform TypeError is not the cause: it can carry the raw string, secrets included.
    throw new HttpConfigError(`Invalid URL: ${JSON.stringify(redactUrl(href))}`);
  }
}

/** Refuses a URL with userinfo: `fetch` rejects it with a `TypeError` whose message holds the password. */
function withoutCredentials(url: URL): URL {
  if (url.username !== "" || url.password !== "") {
    throw new HttpConfigError(
      `URL ${JSON.stringify(redactUrl(url.href))} carries credentials; send them in a header (e.g. an auth filter) instead`,
    );
  }
  return url;
}

/**
 * Resolves `input` to a fresh URL the caller may mutate.
 *
 * An absolute `input` (a `scheme://` string or a `URL`) is used as it is and `baseUrl` is ignored.
 * A relative `input` is joined to the path of `baseUrl` with exactly one `/` between them, whether
 * or not either side carries one at the join; the base's query and hash are dropped, the input's
 * own are kept. `..` segments are resolved by the URL parser after the join, so `../x` can climb
 * above the base path. A string without `://`, such as `localhost:3000/x`, is relative.
 *
 * @throws HttpConfigError for a protocol-relative `//host/x`, for a relative `input` without a
 *   `baseUrl`, for a string that does not parse as a URL, and for a resolved URL that carries a
 *   username or password, from `input` or from `baseUrl`. Each message carries the input through
 *   `redactUrl` and the error has no `cause`, since the platform `TypeError` holds the raw string.
 */
export function resolveUrl(input: string | URL, baseUrl?: URL): URL {
  if (typeof input !== "string") {
    return withoutCredentials(new URL(input.href));
  }
  if (ABSOLUTE_URL.test(input)) {
    return withoutCredentials(parse(input));
  }
  if (input.startsWith("//")) {
    throw new HttpConfigError(`Protocol-relative URL ${JSON.stringify(redactUrl(input))} is not supported; give an absolute URL or a path`);
  }
  if (baseUrl === undefined) {
    throw new HttpConfigError(`Relative URL ${JSON.stringify(redactUrl(input))} needs a baseUrl`);
  }
  const base = new URL(baseUrl.href);
  base.search = "";
  base.hash = "";
  return withoutCredentials(parse(`${base.href.replace(/\/$/, "")}/${input.replace(/^\//, "")}`));
}
