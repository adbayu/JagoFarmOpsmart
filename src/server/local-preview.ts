import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "./app.js";
import type { Database } from "./db.js";
import { createLocalAuth } from "./identity.js";

export async function createLocalPreview(options: {
  dataDir: string;
  origin: string;
  migrationDir?: string;
}) {
  await mkdir(options.dataDir, { recursive: true });
  const sql = new PGlite(options.dataDir);
  try {
    await sql.exec(
      "CREATE TABLE IF NOT EXISTS schema_migration(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const migrationDir = options.migrationDir ?? "db/migrations";
    for (const name of (await readdir(migrationDir))
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      const migration = await readFile(join(migrationDir, name), "utf8");
      const checksum = createHash("sha256").update(migration).digest("hex");
      const applied = await sql.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migration WHERE name=$1",
        [name],
      );
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await sql.transaction(async (tx) => {
        await tx.exec(migration);
        await tx.query(
          "INSERT INTO schema_migration(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
      });
    }

    const db: Database = {
      transaction: (work) => sql.transaction((tx) => work(tx)),
    };
    const auth = createLocalAuth(db, {
      origin: options.origin,
      secureCookies: false,
    });
    return {
      app: createApp(db, auth.resolveIdentity, auth),
      db,
      close: () => sql.close(),
    };
  } catch (error) {
    await sql.close();
    throw error;
  }
}
