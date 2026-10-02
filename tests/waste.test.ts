import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database, Sql } from "../src/server/db.js";
import { createApp } from "../src/server/app.js";
import {
  createWasteRecord,
  transitionWasteRecord,
} from "../src/modules/waste/service.js";
import {
  getWasteRecord,
  listWasteRecords,
} from "../src/modules/waste/queries.js";
import type { WasteSummary } from "../src/modules/waste/contracts.js";
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
const createInput = (idempotencyKey: string) => ({
  idempotencyKey,
  source: "Sisa sayuran",
  quantity: "2.5",
  unit: "KG",
  wasteDate: "2026-09-30",
  notes: "Catatan uji",
});

test("waste record is idempotent, owner-scoped and does not alter stock", async () => {
  const f = await fixture(sql);
  const context = { farmId: f.farmId, actorId: f.actorId };
  const before = await sql.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM inventory_movement WHERE farm_id=$1",
    [f.farmId],
  );
  const input = createInput(key());
  const created = await createWasteRecord(db, context, input);
  assert.deepEqual(await createWasteRecord(db, context, input), created);
  const detail = await getWasteRecord(db, f.actorId, f.farmId, created.wasteId);
  assert.equal(detail.source, "Sisa sayuran");
  assert.equal(detail.quantity, "2.500");
  assert.equal(detail.unit, "KG");
  assert.equal(detail.status, "RECORDED");
  assert.equal(detail.createdByName, "DEVELOPMENT TEST USER");
  assert.deepEqual(
    detail.history.map((entry) => entry.toStatus),
    ["RECORDED"],
  );
  assert.equal(detail.history[0]?.changedByName, "DEVELOPMENT TEST USER");
  assert.ok(Date.parse(detail.history[0]?.changedAt ?? "") > 0);
  assert.equal((await listWasteRecords(db, f.actorId, f.farmId)).length, 1);
  const after = await sql.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM inventory_movement WHERE farm_id=$1",
    [f.farmId],
  );
  assert.equal(after.rows[0]?.count, before.rows[0]?.count);
  await assert.rejects(
    getWasteRecord(db, randomUUID(), f.farmId, created.wasteId),
    { code: "FORBIDDEN" },
  );
  const otherFarm = await fixture(sql);
  await assert.rejects(listWasteRecords(db, f.actorId, otherFarm.farmId), {
    code: "FORBIDDEN",
  });
  await assert.rejects(
    getWasteRecord(db, f.actorId, otherFarm.farmId, created.wasteId),
    { code: "FORBIDDEN" },
  );
});

test("failure to write initial waste history rolls back record and receipt", async () => {
  const f = await fixture(sql);
  const idempotencyKey = key();
  const broken: Database = {
    transaction: (work) =>
      db.transaction((tx) =>
        work({
          query: <T extends Record<string, unknown>>(
            text: string,
            params?: unknown[],
          ) =>
            text.startsWith("INSERT INTO waste_status_event")
              ? Promise.reject(new Error("history write failed"))
              : tx.query<T>(text, params),
        } as Sql),
      ),
  };
  await assert.rejects(
    createWasteRecord(
      broken,
      { farmId: f.farmId, actorId: f.actorId },
      createInput(idempotencyKey),
    ),
    /history write failed/,
  );
  assert.equal(
    (
      await sql.query("SELECT id FROM waste_record WHERE farm_id=$1", [
        f.farmId,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await sql.query(
        "SELECT idempotency_key FROM command_receipt WHERE farm_id=$1 AND operation='waste.createRecord' AND idempotency_key=$2",
        [f.farmId, idempotencyKey],
      )
    ).rows.length,
    0,
  );
});

test("waste status transitions require the expected state and record usage history", async () => {
  const f = await fixture(sql);
  const context = { farmId: f.farmId, actorId: f.actorId };
  const memberId = randomUUID();
  await sql.query(
    "INSERT INTO app_user(id,auth_subject,display_name) VALUES($1,$2,$3)",
    [memberId, `test:${memberId}`, "Farm Member"],
  );
  await sql.query(
    "INSERT INTO farm_membership(farm_id,user_id,added_by) VALUES($1,$2,$3)",
    [f.farmId, memberId, f.actorId],
  );
  const { wasteId } = await createWasteRecord(db, context, createInput(key()));
  const processing = await transitionWasteRecord(
    db,
    { farmId: f.farmId, actorId: memberId },
    wasteId,
    {
      idempotencyKey: key(),
      expectedStatus: "RECORDED",
      status: "PROCESSING",
    },
  );
  assert.equal(processing.status, "PROCESSING");
  assert.equal(processing.history[1]?.changedByName, "Farm Member");
  await transitionWasteRecord(db, context, wasteId, {
    idempotencyKey: key(),
    expectedStatus: "PROCESSING",
    status: "PROCESSED",
  });
  const reused = await transitionWasteRecord(db, context, wasteId, {
    idempotencyKey: key(),
    expectedStatus: "PROCESSED",
    status: "REUSED",
    usage: "Kompos untuk Area Taman",
  });
  assert.equal(reused.status, "REUSED");
  assert.equal(reused.usage, "Kompos untuk Area Taman");
  assert.deepEqual(
    reused.history.map((entry) => entry.toStatus),
    ["RECORDED", "PROCESSING", "PROCESSED", "REUSED"],
  );
  await assert.rejects(
    transitionWasteRecord(db, context, wasteId, {
      idempotencyKey: key(),
      expectedStatus: "RECORDED",
      status: "DISPOSED",
      usage: "Sisa",
    }),
    { code: "CONFLICT" },
  );
});

test("waste validation rejects fractional unit stock and reuse without a destination", async () => {
  const f = await fixture(sql);
  const context = { farmId: f.farmId, actorId: f.actorId };
  await assert.rejects(
    createWasteRecord(db, context, { ...createInput(key()), quantity: "0" }),
  );
  await assert.rejects(
    createWasteRecord(db, context, {
      ...createInput(key()),
      quantity: "1.2",
      unit: "UNIT",
    }),
    { code: "VALIDATION" },
  );
  const { wasteId } = await createWasteRecord(db, context, createInput(key()));
  await assert.rejects(
    transitionWasteRecord(db, context, wasteId, {
      idempotencyKey: key(),
      expectedStatus: "RECORDED",
      status: "REUSED",
    }),
    { code: "CONFLICT" },
  );
});

test("waste HTTP routes create and list records for the authenticated farm", async () => {
  const f = await fixture(sql);
  const server = createApp(db, async () => ({ userId: f.actorId })).listen(
    0,
    "127.0.0.1",
  );
  try {
    if (!server.listening)
      await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/farms/${f.farmId}/waste`;
    const created = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createInput(key())),
    });
    assert.equal(created.status, 200);
    const createdBody = (await created.json()) as {
      data: { wasteId: string };
    };
    const list = await fetch(base);
    assert.equal(list.status, 200);
    const body = (await list.json()) as { data: WasteSummary[] };
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.createdByName, "DEVELOPMENT TEST USER");
    const detail = await fetch(`${base}/${createdBody.data.wasteId}`);
    assert.equal(detail.status, 200);
    const detailBody = (await detail.json()) as {
      data: { createdByName: string; history: { changedByName: string }[] };
    };
    assert.equal(detailBody.data.createdByName, "DEVELOPMENT TEST USER");
    assert.equal(
      detailBody.data.history[0]?.changedByName,
      "DEVELOPMENT TEST USER",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
