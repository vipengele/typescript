import type { Terminal } from "./chain";
import type { HttpFetch } from "./context";

/** The resolved configuration a client carries; every member is read-only. */
export interface ClientConfig {
  /** The URL relative request paths are joined to. */
  readonly baseUrl?: URL;
  /** The headers every request starts with. Consumers must not mutate them; request building copies them. */
  readonly headers: Headers;
  /** The compiled chain: the filters, in running order, in front of dispatch. */
  readonly chain: Terminal;
  /** The fetch dispatch sends through, already resolved by `resolveFetch`. */
  readonly fetch: HttpFetch;
  /** Whether a response with a failing status is raised as an `HttpStatusError`. */
  readonly throwOnError: boolean;
}
