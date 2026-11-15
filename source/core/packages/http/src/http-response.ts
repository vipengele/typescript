/**
 * A response read without status conversion: its status, headers and body, with the raw
 * `Response` alongside.
 */
export interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly statusText: string;
  readonly headers: Headers;
  readonly url: string;
  /** The `Response` the chain produced. */
  readonly raw: Response;
  /**
   * Reads the body as JSON. An empty body resolves `undefined`: status 204 or 205, a `HEAD`
   * request, or a zero-length body. Invalid JSON rejects with the parser's `SyntaxError`.
   */
  json<T = unknown>(): Promise<T>;
  /** Reads the body as text. */
  text(): Promise<string>;
  /** Cancels the body without reading it; resolves at once when there is none. */
  discard(): Promise<void>;
}

export async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel();
}

/** Reads `response` as JSON, giving `undefined` for status 204 or 205, a `HEAD` request or a zero-length body. */
export async function decodeJson<T>(response: Response, method: string): Promise<T> {
  if (response.status === 204 || response.status === 205 || method === "HEAD") {
    return undefined as T;
  }
  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

export function toHttpResponse(raw: Response, method: string): HttpResponse {
  return {
    status: raw.status,
    ok: raw.ok,
    statusText: raw.statusText,
    headers: raw.headers,
    url: raw.url,
    raw,
    json: <T>() => decodeJson<T>(raw, method),
    text: () => raw.text(),
    discard: () => cancelBody(raw),
  };
}
