// In-memory `IDBFactory` fakes for tests; nothing in shipped code imports this file.

interface Row {
  id: number;
  key: string;
  body: string;
  count: number;
}

type Handler = (() => void) | null;

export interface MemoryIndexedDb {
  readonly factory: IDBFactory;
  readonly rows: Row[];
  readonly opens: string[];
  readonly closed: () => number;
}

/**
 * An `IDBFactory` over an array: requests succeed on a microtask and a transaction completes on the
 * next task. With `hang`, a transaction never completes, so a write stays pending.
 */
export function memoryIndexedDb(rows: Row[] = [], hang = false): MemoryIndexedDb {
  const opens: string[] = [];
  let nextId = rows.length;
  let closed = 0;
  const respond = (result: unknown) => {
    const request: { result: unknown; onsuccess: Handler } = { result: undefined, onsuccess: null };
    queueMicrotask(() => {
      request.result = result;
      request.onsuccess?.();
    });
    return request;
  };
  const database = {
    onversionchange: null as Handler,
    close: () => {
      closed += 1;
    },
    transaction: () => {
      const transaction = {
        oncomplete: null as Handler,
        onabort: null as Handler,
        objectStore: () => ({
          getAll: () => respond(rows.slice()),
          add: (row: Omit<Row, "id">) => {
            nextId += 1;
            rows.push({ ...row, id: nextId });
            return respond(undefined);
          },
          delete: (id: number) => {
            rows.splice(
              rows.findIndex((row) => row.id === id),
              1,
            );
            return respond(undefined);
          },
          index: () => ({ get: (key: string) => respond(rows.find((row) => row.key === key)) }),
        }),
      };
      if (!hang) {
        setTimeout(() => transaction.oncomplete?.(), 0);
      }
      return transaction;
    },
  };
  const factory = {
    open: (name: string) => {
      opens.push(name);
      const request: { result: unknown; onsuccess: Handler } = { result: database, onsuccess: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, rows, opens, closed: () => closed };
}

/** An `IDBFactory` whose open fails. */
export function failingIndexedDb(): IDBFactory {
  return {
    open: () => {
      const request: { onerror: Handler } = { onerror: null };
      queueMicrotask(() => request.onerror?.());
      return request;
    },
  } as unknown as IDBFactory;
}
