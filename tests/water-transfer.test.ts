import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../src/server/db.js";
import { createApp } from "../src/server/app.js";
import { createWaterTransfer } from "../src/modules/circular/service.js";
import { listWaterTransfers } from "../src/modules/circular/queries.js";
import { fixture } from "./fixture.js";

let sql: PGlite;
let db: Database;
before(async () => {
  sql = new PGlite();
  for (const name of (await readdir("db/migrations"))
    .filter((item) => item.endsWith(".sql"))
    .sort())
    await sql.exec(await readFile(`db/migrations/${name}`, "utf8"));
  db = { transaction: (work) => sql.transaction((tx) => work(tx)) };
});
after(async () => {
  await sql.close();
});

const key = () => randomUUID();

async function makeCropUnit(farmId: string, name = "Area Tanam") {
  const id = randomUUID();
  await sql.query(
    "INSERT INTO farm_unit(id,farm_id,name,farming_type) VALUES($1,$2,$3,'CROP')",
    [id, farmId, name],
  );
  await sql.query(
    "INSERT INTO growing_area(unit_id,farm_id,area_m2) VALUES($1,$2,12)",
    [id, farmId],
  );
  return id;
}

test("water transfer records append-only liters from a fish pond to a crop area without stock or cost changes", async () => {
  const f = await fixture(sql);
  const cropUnitId = await makeCropUnit(f.farmId);
  const before = await sql.query<{ movements: string; costs: string }>(
    `SELECT (SELECT count(*)::text FROM inventory_movement WHERE farm_id=$1) AS movements,
      (SELECT count(*)::text FROM cost_entry WHERE farm_id=$1) AS costs`,
    [f.farmId],
  );
  const input = {
    idempotencyKey: key(),
    sourceUnitId: f.unitId,
    targetUnitId: cropUnitId,
    quantityLiters: "125.75",
    transferDate: "2026-09-30",
    note: "Penyiraman bedeng utara",
  };
  const created = await createWaterTransfer(
    db,
    { farmId: f.farmId, actorId: f.actorId },
    input,
  );
  assert.deepEqual(
    await createWaterTransfer(
      db,
      { farmId: f.farmId, actorId: f.actorId },
      input,
    ),
    created,
  );
  const rows = await listWaterTransfers(db, f.actorId, f.farmId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sourceUnitName, "Kolam A");
  assert.equal(rows[0]?.targetUnitName, "Area Tanam");
  assert.equal(rows[0]?.quantityLiters, "125.750");
  assert.equal(rows[0]?.transferDate, "2026-09-30");
  assert.equal(rows[0]?.note, "Penyiraman bedeng utara");
  assert.equal(rows[0]?.createdByName, "DEVELOPMENT TEST USER");
  assert.ok(Date.parse(rows[0]?.createdAt ?? "") > 0);
  await assert.rejects(
    createWaterTransfer(
      db,
      { farmId: f.farmId, actorId: f.actorId },
      {
        ...input,
        quantityLiters: "125.76",
      },
    ),
    { code: "CONFLICT" },
  );
  const after = await sql.query<{ movements: string; costs: string }>(
    `SELECT (SELECT count(*)::text FROM inventory_movement WHERE farm_id=$1) AS movements,
      (SELECT count(*)::text FROM cost_entry WHERE farm_id=$1) AS costs`,
    [f.farmId],
  );
  assert.deepEqual(after.rows[0], before.rows[0]);
});

test("water transfer requires a same-farm fish source and crop destination", async () => {
  const f = await fixture(sql);
  const other = await fixture(sql);
  const cropUnitId = await makeCropUnit(f.farmId);
  const input = {
    idempotencyKey: key(),
    sourceUnitId: f.unitId,
    targetUnitId: cropUnitId,
    quantityLiters: "1",
    transferDate: "2026-09-30",
  };
  await assert.rejects(
    createWaterTransfer(
      db,
      { farmId: f.farmId, actorId: f.actorId },
      {
        ...input,
        sourceUnitId: cropUnitId,
      },
    ),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    createWaterTransfer(
      db,
      { farmId: f.farmId, actorId: f.actorId },
      {
        ...input,
        targetUnitId: other.unitId,
      },
    ),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    createWaterTransfer(
      db,
      { farmId: other.farmId, actorId: other.actorId },
      {
        ...input,
        sourceUnitId: f.unitId,
      },
    ),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(listWaterTransfers(db, other.actorId, f.farmId), {
    code: "FORBIDDEN",
  });
});

test("water transfer HTTP routes list and create farm-scoped records", async () => {
  const f = await fixture(sql);
  const cropUnitId = await makeCropUnit(f.farmId);
  const server = createApp(db, async () => ({ userId: f.actorId })).listen(
    0,
    "127.0.0.1",
  );
  try {
    if (!server.listening)
      await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/circular/water-transfers`;
    const sources = await fetch(
      `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/circular/water-transfer-units/fish`,
    );
    assert.equal(sources.status, 200);
    assert.equal(
      ((await sources.json()) as { data: unknown[] }).data.length,
      1,
    );
    const created = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: key(),
        sourceUnitId: f.unitId,
        targetUnitId: cropUnitId,
        quantityLiters: "20",
        transferDate: "2026-09-30",
      }),
    });
    assert.equal(created.status, 200);
    const list = await fetch(base);
    assert.equal(list.status, 200);
    const body = (await list.json()) as { data: unknown[] };
    assert.equal(body.data.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
