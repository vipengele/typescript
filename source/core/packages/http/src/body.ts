/** A request body: anything `fetch` accepts, or an async iterable of byte chunks. */
export type HttpBody = BodyInit | AsyncIterable<Uint8Array>;

/**
 * Whether `body` can be sent only once.
 *
 * A `ReadableStream` or an async iterable is consumed by the first send, so a retry or a second
 * dispatch cannot reproduce it. Strings, `Blob`, `FormData`, `URLSearchParams`, buffers, `null`
 * and `undefined` are replayable. The object check runs before `in`, which throws on a string.
 */
export function isOneShotBody(body: HttpBody | null | undefined): boolean {
  if (body instanceof ReadableStream) {
    return true;
  }
  return typeof body === "object" && body !== null && Symbol.asyncIterator in body;
}

/**
 * Wraps an async iterable of byte chunks in a `ReadableStream` that pulls one chunk per read.
 *
 * The stream closes when the iterator is done and errors when it throws; cancelling the stream
 * calls the iterator's `return`, so a generator runs its `finally` blocks.
 */
export function toReadableStream(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await iterator.next();
      if (result.done) {
        controller.close();
      } else {
        controller.enqueue(result.value);
      }
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}
