import type { Resource } from "@vipengele/ts-core-common/scope";
import type { KeyValue } from "./any-value";

/** The semantic-conventions version the mapping targets, raised deliberately rather than followed (ADR-0008). */
export const SEMCONV_SCHEMA_URL = "https://opentelemetry.io/schemas/1.37.0";

/** The Resource keys, in the order they are written as resource attributes. */
const RESOURCE_KEYS = [
  "service.name",
  "service.version",
  "service.dist",
  "deployment.environment.name",
  "process.runtime.name",
  "process.runtime.version",
  "os.type",
  "os.version",
  "browser.name",
  "browser.version",
  "device.type",
] as const satisfies readonly (keyof Resource)[];

/** The entries that share one Resource value, split by instrumentation scope name. */
export interface ResourceGroup {
  readonly resource: Resource;
  readonly scopes: Map<string, unknown[]>;
}

/** The Resource as OTLP attributes, in {@link RESOURCE_KEYS} order; a key with no value is left out. */
export function resourceAttributes(resource: Resource): KeyValue[] {
  const attributes: KeyValue[] = [];
  for (const key of RESOURCE_KEYS) {
    const value = resource[key];
    if (value !== undefined) {
      attributes.push({ key, value: { stringValue: value } });
    }
  }
  return attributes;
}

/**
 * Groups `entries` by Resource *value*, compared key by key and never by identity: a provider reads
 * a fresh Resource object for every record, so identity would give each entry a group of its own.
 * Within a Resource, `encode`d entries are grouped by the scope name `scopeOf` gives. Groups appear
 * in the order their first entry does, and entries keep their order within a group.
 */
export function groupByResource<E extends { readonly resource: Resource }>(
  entries: ReadonlyArray<E>,
  scopeOf: (entry: E) => string,
  encode: (entry: E) => unknown,
): ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>();
  for (const entry of entries) {
    const key = resourceKey(entry.resource);
    let group = groups.get(key);
    if (group === undefined) {
      group = { resource: entry.resource, scopes: new Map() };
      groups.set(key, group);
    }
    const name = scopeOf(entry);
    let encoded = group.scopes.get(name);
    if (encoded === undefined) {
      encoded = [];
      group.scopes.set(name, encoded);
    }
    encoded.push(encode(entry));
  }
  return [...groups.values()];
}

/** The Resource's values as one string, equal for two Resources exactly when every key's value is. */
function resourceKey(resource: Resource): string {
  return JSON.stringify(RESOURCE_KEYS.map((key) => resource[key] ?? null));
}
