type SqlStorageValue = null | string | number | ArrayBuffer | Uint8Array;

interface SqlStorageCursor<T extends Record<string, SqlStorageValue>> {
  toArray(): T[];
}

interface SqlStorage {
  exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ): SqlStorageCursor<T>;
}

interface DurableObjectStorage {
  sql: SqlStorage;
  transactionSync<T>(callback: () => T): T;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

declare module "cloudflare:workers" {
  export class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

declare module "cloudflare:node" {
  interface NodeHandler {
    fetch?: (
      request: Request,
      env?: unknown,
      ctx?: { waitUntil(promise: Promise<unknown>): void },
    ) => Response | Promise<Response>;
  }
  export function httpServerHandler(options: { port: number }): NodeHandler;
}
