import { HttpConfigError } from "./errors/http-errors";

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

function parse(href: string): URL {
  try {
    return new URL(href);
  } catch (cause) {
    throw new HttpConfigError(`Invalid URL: ${JSON.stringify(href)}`, { cause });
  }
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
 *   `baseUrl`, and for a string that does not parse as a URL (the `TypeError` is the `cause`).
 */
export function resolveUrl(input: string | URL, baseUrl?: URL): URL {
  if (typeof input !== "string") {
    return new URL(input.href);
  }
  if (ABSOLUTE_URL.test(input)) {
    return parse(input);
  }
  if (input.startsWith("//")) {
    throw new HttpConfigError(`Protocol-relative URL ${JSON.stringify(input)} is not supported; give an absolute URL or a path`);
  }
  if (baseUrl === undefined) {
    throw new HttpConfigError(`Relative URL ${JSON.stringify(input)} needs a baseUrl`);
  }
  const base = new URL(baseUrl.href);
  base.search = "";
  base.hash = "";
  return parse(`${base.href.replace(/\/$/, "")}/${input.replace(/^\//, "")}`);
}
