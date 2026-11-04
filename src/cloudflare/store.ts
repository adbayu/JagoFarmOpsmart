import { createHash } from "node:crypto";
import { DurableObject } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { PGlite } from "@dotdo/pglite";
import postgresFsBundle from "../../node_modules/@dotdo/pglite/dist/pglite.data";
import pgliteWasm from "../../node_modules/@dotdo/pglite/dist/pglite.wasm";
import migration001 from "../../db/migrations/001_foundation.sql";
import migration002 from "../../db/migrations/002_farm_archive.sql";
import migration003 from "../../db/migrations/003_local_auth.sql";
import migration004 from "../../db/migrations/004_cycle_observations.sql";
import migration005 from "../../db/migrations/005_cost_corrections.sql";
import migration006 from "../../db/migrations/006_sale_payments.sql";
import migration007 from "../../db/migrations/007_finance_policy.sql";
import migration008 from "../../db/migrations/008_farm_membership.sql";
import migration009 from "../../db/migrations/009_waste_records.sql";
import migration010 from "../../db/migrations/010_maggot_batches.sql";
import migration011 from "../../db/migrations/011_circular_maggot_posting.sql";
import migration012 from "../../db/migrations/012_notifications_outbox.sql";
import migration013 from "../../db/migrations/013_circular_water_transfer.sql";
import migration014 from "../../db/migrations/014_daily_standup.sql";
import migration015 from "../../db/migrations/015_kolab_standup_sync.sql";
import { processNotificationWorkerTick } from "../modules/notifications/worker.js";
import { createApp } from "../server/app.js";
import type { Database, Sql } from "../server/db.js";
import { createLocalAuth } from "../server/identity.js";

const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const HTTP_PORT = 3000;

const migrations = [
  ["001_foundation.sql", migration001],
  ["002_farm_archive.sql", migration002],
  ["003_local_auth.sql", migration003],
  ["004_cycle_observations.sql", migration004],
  ["005_cost_corrections.sql", migration005],
  ["006_sale_payments.sql", migration006],
  ["007_finance_policy.sql", migration007],
  ["008_farm_membership.sql", migration008],
  ["009_waste_records.sql", migration009],
  ["010_maggot_batches.sql", migration010],
  ["011_circular_maggot_posting.sql", migration011],
  ["012_notifications_outbox.sql", migration012],
  ["013_circular_water_transfer.sql", migration013],
  ["014_daily_standup.sql", migration014],
  ["015_kolab_standup_sync.sql", migration015],
] as const;

interface SnapshotHead extends Record<string, SqlStorageValue> {
  snapshot_id: string;
  chunk_count: number;
  byte_length: number;
  checksum: string;
}

interface SnapshotChunk extends Record<string, SqlStorageValue> {
  chunk_index: number;
  payload: ArrayBuffer | Uint8Array;
}

interface Env {
  APP_ORIGIN: string;
}

function isMutatingQuery(text: string): boolean {
  const sql = text
    .replace(/^\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))\s*/g, "")
    .trimStart();
  if (/^WITH\b/i.test(sql))
    return /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql);
  if (/^(?:SELECT|VALUES|SHOW|EXPLAIN)\b/i.test(sql))
    return /;\s*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP)\b/i.test(sql);
  return true;
}

function workerMigrationSql(name: string, migration: string): string {
  const unsupportedTriggers: Record<string, RegExp> = {
    "001_foundation.sql":
      /CREATE FUNCTION protect_movement\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$[\s\S]*?\$\$;\s*CREATE TRIGGER immutable_movement[\s\S]*?;/,
    "009_waste_records.sql":
      /CREATE FUNCTION protect_waste_status_event\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$[\s\S]*?\$\$;\s*CREATE TRIGGER waste_status_event_immutable[\s\S]*?;/,
    "014_daily_standup.sql":
      /CREATE FUNCTION preserve_standup_publication\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$[\s\S]*?\$\$;\s*CREATE TRIGGER preserve_standup_publication[\s\S]*?;/,
  };
  const pattern = unsupportedTriggers[name];
  if (!pattern) return migration;
  const result = migration.replace(pattern, "");
  if (result === migration)
    throw new Error(`Expected PostgreSQL trigger block was not found in ${name}`);
  return result;
}

function assertWorkerMutationAllowed(text: string): void {
  const sql = text
    .replace(/--[^\n]*(?:\n|$)/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  if (
    /\b(?:UPDATE\s+(?:ONLY\s+)?(?:public\.)?|DELETE\s+FROM\s+(?:ONLY\s+)?(?:public\.)?)(?:inventory_movement|waste_status_event)\b/i.test(
      sql,
    )
  )
    throw new Error("Inventory and waste history rows are append-only");
  if (/\bDELETE\s+FROM\s+(?:ONLY\s+)?(?:public\.)?daily_standup\b/i.test(sql))
    throw new Error("Standup history cannot be deleted");
  if (/\bUPDATE\s+(?:ONLY\s+)?(?:public\.)?daily_standup\b/i.test(sql))
    throw new Error("Standup history must be updated through its protected upsert");
  if (/\bINSERT\s+INTO\s+(?:public\.)?daily_standup\b/i.test(sql)) {
    const updateSet = sql.match(
      /ON\s+CONFLICT\s*\([^)]*\)\s+DO\s+UPDATE\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i,
    )?.[1];
    if (
      updateSet &&
      /(?:^|,)\s*(?:id|user_id|report_date|created_at)\s*=/i.test(updateSet)
    )
      throw new Error("Standup identity fields cannot be changed");
    if (
      updateSet &&
      /\bpublished_at\s*=\s*NULL\b/i.test(updateSet)
    )
      throw new Error("Published standup history cannot be unpublished");
    if (
      updateSet &&
      /\bpublished_at\s*=/i.test(updateSet) &&
      !/\bpublished_at\s*=\s*CASE\s+WHEN[\s\S]*?\bELSE\s+daily_standup\.published_at\s+END/i.test(
        updateSet,
      )
    )
      throw new Error("Published standup history must remain published");
  }
}

function bytesOf(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export class OpSmartStore extends DurableObject<Env> {
  private readonly ready: Promise<void>;
  private database?: Database;
  private httpHandler?: ReturnType<typeof httpServerHandler>;
  private transactionTail: Promise<void> = Promise.resolve();
  private persistenceFailed = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(() => this.initialize());
  }

  async fetch(request: Request): Promise<Response> {
    try {
      await this.ready;
    } catch {
      return this.unavailableResponse();
    }
    if (this.persistenceFailed || !this.httpHandler?.fetch)
      return this.unavailableResponse();
    return this.httpHandler.fetch(
      request,
      this.env,
      this.ctx as unknown as { waitUntil(promise: Promise<unknown>): void },
    );
  }

  async runNotificationTick(): Promise<void> {
    await this.ready;
    if (this.persistenceFailed || !this.database)
      throw new Error("OpSmart database persistence is unavailable");
    await processNotificationWorkerTick(this.database);
  }

  private unavailableResponse(): Response {
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Layanan sedang disiapkan. Coba lagi sebentar.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  private async initialize(): Promise<void> {
    const sqlStorage = this.ctx.storage.sql;
    sqlStorage.exec(`
      CREATE TABLE IF NOT EXISTS opsmart_snapshot_head (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        snapshot_id TEXT NOT NULL,
        chunk_count INTEGER NOT NULL,
        byte_length INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS opsmart_snapshot_chunk (
        snapshot_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        payload BLOB NOT NULL,
        PRIMARY KEY(snapshot_id, chunk_index)
      );
    `);

    const snapshot = await this.loadSnapshot();
    const runtimeProcessDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "process",
    );
    const runtimeWindowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const workerScope = (globalThis as unknown as { self?: object }).self;
    const hasWorkerLocation = Boolean(
      (workerScope as { location?: unknown } | undefined)?.location,
    );
    const workerLocationDescriptor = workerScope
      ? Object.getOwnPropertyDescriptor(workerScope, "location")
      : undefined;
    let postgres: PGlite;
    try {
      // PGlite's generated Emscripten loader treats nodejs_compat's process shim
      // as Node and then tries to resolve a filesystem URL that Workers do not have.
      if (runtimeProcessDescriptor?.configurable) {
        Object.defineProperty(globalThis, "process", {
          configurable: true,
          value: undefined,
        });
      }
      if (runtimeWindowDescriptor?.configurable)
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: undefined,
        });
      if (workerScope && !hasWorkerLocation)
        Object.defineProperty(workerScope, "location", {
          configurable: true,
          value: {
            href: `${this.env.APP_ORIGIN}/`,
            pathname: "/index.js",
          },
        });
      postgres = await PGlite.create({
        wasmModule: pgliteWasm,
        fsBundle: new Blob([postgresFsBundle]),
        ...(snapshot ? { loadDataDir: snapshot } : {}),
      });
    } finally {
      if (runtimeProcessDescriptor?.configurable)
        Object.defineProperty(globalThis, "process", runtimeProcessDescriptor);
      if (runtimeWindowDescriptor?.configurable)
        Object.defineProperty(globalThis, "window", runtimeWindowDescriptor);
      if (workerScope && !hasWorkerLocation) {
        if (workerLocationDescriptor)
          Object.defineProperty(workerScope, "location", workerLocationDescriptor);
        else Reflect.deleteProperty(workerScope, "location");
      }
    }
    await postgres.waitReady;
    await this.applyMigrations(postgres);

    const database = this.createDatabase(postgres);
    const auth = createLocalAuth(database, {
      origin: this.env.APP_ORIGIN,
      secureCookies: true,
    });
    const app = createApp(database, auth.resolveIdentity, auth);
    app.listen(HTTP_PORT);
    this.httpHandler = httpServerHandler({ port: HTTP_PORT });
    this.database = database;

    if (!snapshot) await this.persistSnapshot(postgres);
  }

  private async loadSnapshot(): Promise<Blob | undefined> {
    const head = this.ctx.storage.sql
      .exec<SnapshotHead>(
        `SELECT snapshot_id,chunk_count,byte_length,checksum
         FROM opsmart_snapshot_head WHERE singleton=1`,
      )
      .toArray()[0];
    if (!head) return undefined;
    if (head.byte_length <= 0 || head.byte_length > MAX_SNAPSHOT_BYTES)
      throw new Error("Stored OpSmart snapshot size is invalid");

    const chunks = this.ctx.storage.sql
      .exec<SnapshotChunk>(
        `SELECT chunk_index,payload FROM opsmart_snapshot_chunk
         WHERE snapshot_id=? ORDER BY chunk_index`,
        head.snapshot_id,
      )
      .toArray();
    if (chunks.length !== head.chunk_count)
      throw new Error("Stored OpSmart snapshot is incomplete");

    const data = new Uint8Array(head.byte_length);
    let offset = 0;
    chunks.forEach((chunk, index) => {
      if (chunk.chunk_index !== index) throw new Error("Snapshot chunk gap");
      const bytes = bytesOf(chunk.payload);
      data.set(bytes, offset);
      offset += bytes.byteLength;
    });
    if (offset !== head.byte_length) throw new Error("Snapshot size mismatch");

    const checksum = hex(await crypto.subtle.digest("SHA-256", data));
    if (checksum !== head.checksum) throw new Error("Snapshot checksum mismatch");
    return new Blob([data]);
  }

  private async persistSnapshot(postgres: PGlite): Promise<void> {
    const archive = await postgres.dumpDataDir("gzip");
    const bytes = new Uint8Array(await archive.arrayBuffer());
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SNAPSHOT_BYTES)
      throw new Error("OpSmart snapshot exceeded the configured storage limit");

    const checksum = hex(await crypto.subtle.digest("SHA-256", bytes));
    const snapshotId = crypto.randomUUID();
    const chunkCount = Math.ceil(bytes.byteLength / SNAPSHOT_CHUNK_BYTES);
    const storage = this.ctx.storage;
    storage.transactionSync(() => {
      for (let index = 0; index < chunkCount; index++) {
        const start = index * SNAPSHOT_CHUNK_BYTES;
        const chunk = bytes.slice(start, start + SNAPSHOT_CHUNK_BYTES);
        storage.sql.exec(
          `INSERT INTO opsmart_snapshot_chunk(snapshot_id,chunk_index,payload)
           VALUES(?,?,?)`,
          snapshotId,
          index,
          chunk.buffer,
        );
      }
      storage.sql.exec(
        `INSERT INTO opsmart_snapshot_head(singleton,snapshot_id,chunk_count,byte_length,checksum)
         VALUES(1,?,?,?,?)
         ON CONFLICT(singleton) DO UPDATE SET snapshot_id=excluded.snapshot_id,
           chunk_count=excluded.chunk_count,byte_length=excluded.byte_length,checksum=excluded.checksum`,
        snapshotId,
        chunkCount,
        bytes.byteLength,
        checksum,
      );
      storage.sql.exec(
        "DELETE FROM opsmart_snapshot_chunk WHERE snapshot_id<>?",
        snapshotId,
      );
    });
  }

  private async applyMigrations(postgres: PGlite): Promise<void> {
    await postgres.exec(
      `CREATE TABLE IF NOT EXISTS schema_migration(
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );

    for (const [name, migration] of migrations) {
      const checksum = createHash("sha256").update(migration).digest("hex");
      const applied = await postgres.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migration WHERE name=$1",
        [name],
      );
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await postgres.transaction(async (tx) => {
        // PGlite's Cloudflare build omits PL/pgSQL. The three trigger-backed
        // invariants are enforced by the application SQL adapter below.
        await tx.exec(workerMigrationSql(name, migration));
        await tx.query(
          "INSERT INTO schema_migration(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
      });
    }
  }

  private createDatabase(postgres: PGlite): Database {
    return {
      transaction: async <T>(work: (tx: Sql) => Promise<T>): Promise<T> => {
        const previous = this.transactionTail;
        let release!: () => void;
        this.transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          if (this.persistenceFailed)
            throw new Error("OpSmart database persistence is unavailable");
          let mutated = false;
          const result = await postgres.transaction((tx) =>
            work({
              query: <Row extends Record<string, unknown> = Record<string, unknown>>(
                text: string,
                params?: unknown[],
              ) => {
                assertWorkerMutationAllowed(text);
                if (isMutatingQuery(text)) mutated = true;
                return tx.query<Row>(text, params);
              },
            }),
          );
          if (mutated) {
            try {
              await this.persistSnapshot(postgres);
            } catch (error) {
              this.persistenceFailed = true;
              console.error("OpSmart snapshot persistence failed", {
                message: String(error),
              });
              throw error;
            }
          }
          return result;
        } finally {
          release();
        }
      },
    };
  }
}
