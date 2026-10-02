import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/server/db.js";
import { createFarm } from "../src/modules/farms/service.js";
import { getFarm } from "../src/modules/farms/queries.js";

test("existing schema upgrade preserves farms and receipts across a PGlite restart", async () => {
  const testRoot = join(process.cwd(), ".pglite");
  const directory = await mkdtemp(join(testRoot, "opsmart-persistence-"));
  let sql: PGlite | undefined;
  try {
    sql = new PGlite(directory);
    const migrations = (await readdir("db/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    assert.ok(migrations.length > 1);
    for (const name of migrations.slice(0, -1))
      await sql.exec(await readFile(`db/migrations/${name}`, "utf8"));

    const actorId = randomUUID();
    await sql.query(
      "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3)",
      [actorId, `test:${actorId}`, "PERSISTENCE TEST USER"],
    );
    const existingInput = {
      idempotencyKey: randomUUID(),
      name: "Existing schema farm TEST ONLY",
    };
    const database: Database = {
      transaction: (work) => sql!.transaction((tx) => work(tx)),
    };
    const existingFarm = await createFarm(database, actorId, existingInput);
    await sql.exec(
      await readFile(`db/migrations/${migrations.at(-1)!}`, "utf8"),
    );
    const upgradedInput = {
      idempotencyKey: randomUUID(),
      name: "Upgraded schema farm TEST ONLY",
    };
    const upgradedFarm = await createFarm(database, actorId, upgradedInput);
    await sql.close();
    sql = undefined;

    sql = new PGlite(directory);
    const reopened: Database = {
      transaction: (work) => sql!.transaction((tx) => work(tx)),
    };
    assert.deepEqual(
      await getFarm(reopened, actorId, existingFarm.id),
      existingFarm,
    );
    assert.deepEqual(
      await createFarm(reopened, actorId, existingInput),
      existingFarm,
    );
    assert.deepEqual(
      await getFarm(reopened, actorId, upgradedFarm.id),
      upgradedFarm,
    );
    assert.deepEqual(
      await createFarm(reopened, actorId, upgradedInput),
      upgradedFarm,
    );
  } finally {
    await sql?.close();
    const root = await realpath(testRoot);
    const target = await realpath(directory);
    const inside = relative(root, target);
    assert.ok(inside && !inside.startsWith(`..${sep}`) && inside !== "..");
    assert.equal(resolve(root, inside), target);
    await rm(target, { recursive: true, force: true });
  }
});
