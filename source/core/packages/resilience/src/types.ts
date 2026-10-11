/** Passed to every operation a `Policy` runs. */
export interface ExecutionContext {
  /** 1-based number of the current attempt. */
  readonly attempt: number;
  /** Aborted when the caller's signal aborts or the policy gives up on the attempt. */
  readonly signal: AbortSignal;
}

export interface ExecuteOptions {
  readonly signal?: AbortSignal;
}

export interface Policy {
  readonly name: string;
  execute<T>(op: (ctx: ExecutionContext) => Promise<T> | T, options?: ExecuteOptions): Promise<T>;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

export type Unsubscribe = () => void;

export interface Listenable<E> {
  on(listener: (event: E) => void): Unsubscribe;
}
